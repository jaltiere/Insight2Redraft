from decimal import Decimal

import pytest

from app.models import League, PlayerStatCache, Season, Team, WeeklyScore
from app.sync.errors import SyncError
from app.sync.service import LeagueSyncResult, SyncService, WeekSyncResult
from tests.sync.conftest import load_fixture, route_client

# Matches league.json scoring_settings exactly -> validated True.
MATCHING_RULESET = {"rec": 1.0, "pass_td": 4.0, "rush_yd": 0.1, "rec_yd": 0.1}


def _season(db_session) -> Season:
    season = Season(year=2024)
    db_session.add(season)
    db_session.flush()
    return season


async def test_sync_league_setup_upserts_league_and_teams(db_session, league_routes):
    season = _season(db_session)
    service = SyncService(route_client(league_routes), db_session, season, MATCHING_RULESET)

    result = await service.sync_league_setup("987654321")

    assert isinstance(result, LeagueSyncResult)
    league = db_session.query(League).filter_by(sleeper_league_id="987654321").one()
    assert league.name == "Alpha League"
    assert league.season_id == season.id
    assert result.commish_sleeper_id == "100"

    teams = db_session.query(Team).filter_by(league_id=league.id).all()
    assert {t.sleeper_roster_id for t in teams} == {1, 2}
    roster1 = next(t for t in teams if t.sleeper_roster_id == 1)
    assert roster1.sleeper_user_id == "100"
    assert roster1.wins == 9 and roster1.losses == 4
    assert str(roster1.points_for) == "1521.40"


async def test_sync_league_setup_sets_validated_true_on_match(db_session, league_routes):
    season = _season(db_session)
    service = SyncService(route_client(league_routes), db_session, season, MATCHING_RULESET)

    result = await service.sync_league_setup("987654321")

    assert result.scoring_validated is True
    assert result.diffs == []
    league = db_session.query(League).filter_by(sleeper_league_id="987654321").one()
    assert league.scoring_validated is True


async def test_sync_league_setup_flags_validation_diffs(db_session, league_routes):
    season = _season(db_session)
    # platform expects pass_td 6.0 but league has 4.0 -> a diff, not validated
    ruleset = {**MATCHING_RULESET, "pass_td": 6.0}
    service = SyncService(route_client(league_routes), db_session, season, ruleset)

    result = await service.sync_league_setup("987654321")

    assert result.scoring_validated is False
    assert ("pass_td", 4.0, 6.0) in result.diffs


async def test_sync_league_setup_is_idempotent(db_session, league_routes):
    season = _season(db_session)
    service = SyncService(route_client(league_routes), db_session, season, MATCHING_RULESET)

    await service.sync_league_setup("987654321")
    await service.sync_league_setup("987654321")

    assert db_session.query(League).count() == 1
    assert db_session.query(Team).count() == 2


async def test_sync_league_setup_preserves_owner_id(db_session, league_routes):
    season = _season(db_session)
    service = SyncService(route_client(league_routes), db_session, season, MATCHING_RULESET)
    await service.sync_league_setup("987654321")

    league = db_session.query(League).filter_by(sleeper_league_id="987654321").one()
    team = db_session.query(Team).filter_by(league_id=league.id, sleeper_roster_id=1).one()
    team.owner_id = None  # ensure column exists; then simulate an admin mapping below
    from app.models import Owner

    owner = Owner(first_name="Jane", last_name="Doe")
    db_session.add(owner)
    db_session.flush()
    team.owner_id = owner.id
    db_session.flush()

    await service.sync_league_setup("987654321")  # re-sync must not clobber owner_id

    refreshed = db_session.query(Team).filter_by(league_id=league.id, sleeper_roster_id=1).one()
    assert refreshed.owner_id == owner.id


# ---------------------------------------------------------------------------
# sync_week helpers
# ---------------------------------------------------------------------------


def load_fixture_empty():
    return load_fixture("matchups_empty.json")


def _week_routes(league_routes):
    return {
        **league_routes,
        "/league/987654321/matchups/5": load_fixture("matchups.json"),
        "/stats/nfl/regular/2024/5": load_fixture("weekly_stats.json"),
    }


async def _synced_league(db_session, league_routes):
    season = _season(db_session)
    service = SyncService(route_client(_week_routes(league_routes)), db_session, season, MATCHING_RULESET)
    result = await service.sync_league_setup("987654321")
    return service, result.league_id


# ---------------------------------------------------------------------------
# sync_week tests
# ---------------------------------------------------------------------------


async def test_sync_week_records_recompute_and_mismatch(db_session, league_routes):
    service, league_id = await _synced_league(db_session, league_routes)

    result = await service.sync_week(league_id, 5)

    assert isinstance(result, WeekSyncResult)
    assert result.skipped_roster_ids == []

    team = db_session.query(Team).filter_by(league_id=league_id, sleeper_roster_id=1).one()
    score = db_session.query(WeeklyScore).filter_by(team_id=team.id, week=5).one()
    assert score.sleeper_points == Decimal("120.50")
    assert score.recomputed_points == Decimal("23.40")
    assert score.bench_points == Decimal("20.80")
    assert score.mismatch_flag is True


async def test_sync_week_caches_player_stats(db_session, league_routes):
    service, league_id = await _synced_league(db_session, league_routes)

    await service.sync_week(league_id, 5)

    cached = db_session.query(PlayerStatCache).filter_by(
        sleeper_player_id="4046", season=2024, week=5
    ).one()
    assert cached.stats["pass_yd"] == 305


async def test_sync_week_is_idempotent(db_session, league_routes):
    service, league_id = await _synced_league(db_session, league_routes)

    await service.sync_week(league_id, 5)
    await service.sync_week(league_id, 5)

    assert db_session.query(WeeklyScore).count() == 2  # one per team, not four


async def test_sync_week_skips_rosters_without_lineup(db_session, league_routes):
    season = _season(db_session)
    routes = {
        **league_routes,
        "/league/987654321/matchups/18": load_fixture_empty(),
        "/stats/nfl/regular/2024/18": {},
    }
    service = SyncService(route_client(routes), db_session, season, MATCHING_RULESET)
    league_id = (await service.sync_league_setup("987654321")).league_id

    result = await service.sync_week(league_id, 18)

    assert result.scored_team_ids == []
    assert db_session.query(WeeklyScore).count() == 0


async def test_sync_week_skips_populated_roster_with_empty_lineup(db_session, league_routes):
    season = _season(db_session)
    routes = {
        **league_routes,
        "/league/987654321/matchups/6": load_fixture("matchups_skip.json"),
        "/stats/nfl/regular/2024/6": load_fixture("weekly_stats.json"),
    }
    service = SyncService(route_client(routes), db_session, season, MATCHING_RULESET)
    league_id = (await service.sync_league_setup("987654321")).league_id

    result = await service.sync_week(league_id, 6)

    # Roster 2 (empty starters/players_points) must be skipped.
    assert 2 in result.skipped_roster_ids

    team1 = db_session.query(Team).filter_by(league_id=league_id, sleeper_roster_id=1).one()
    team2 = db_session.query(Team).filter_by(league_id=league_id, sleeper_roster_id=2).one()

    assert team2.id not in result.scored_team_ids
    assert db_session.query(WeeklyScore).filter_by(team_id=team2.id, week=6).count() == 0

    # Roster 1 (valid lineup) must be scored.
    assert team1.id in result.scored_team_ids


async def test_sync_week_unknown_league_raises(db_session, league_routes):
    season = _season(db_session)
    service = SyncService(route_client(league_routes), db_session, season, MATCHING_RULESET)
    with pytest.raises(SyncError):
        await service.sync_week(999999, 5)
