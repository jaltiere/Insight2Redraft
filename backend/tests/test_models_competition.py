from decimal import Decimal

from app.models import (
    Account,
    AccountRole,
    League,
    LeagueAdminGrant,
    Owner,
    Season,
    SeasonStatus,
    ScoringRuleset,
    Team,
)


def test_season_with_league_and_team_roundtrip(db_session):
    ruleset = ScoringRuleset(name="Standard PPR", version=1, rules={"rec": 1.0})
    db_session.add(ruleset)
    db_session.flush()

    season = Season(
        year=2026,
        status=SeasonStatus.SETUP,
        scoring_ruleset_id=ruleset.id,
        playoff_field_per_league=2,
        nfl_playoff_weeks=[15, 16, 17],
    )
    league = League(sleeper_league_id="987", name="Alpha League")
    season.leagues.append(league)
    db_session.add(season)
    db_session.flush()

    owner = Owner(first_name="Sam", last_name="Smith")
    db_session.add(owner)
    db_session.flush()

    team = Team(
        league_id=league.id,
        sleeper_roster_id=1,
        owner_id=owner.id,
        wins=10,
        losses=3,
        points_for=Decimal("1450.55"),
    )
    db_session.add(team)
    db_session.commit()

    loaded = db_session.query(Season).filter_by(year=2026).one()
    assert loaded.nfl_playoff_weeks == [15, 16, 17]
    assert loaded.status is SeasonStatus.SETUP
    assert len(loaded.leagues) == 1
    assert loaded.leagues[0].teams[0].points_for == Decimal("1450.55")
    assert loaded.leagues[0].teams[0].wins == 10


def test_league_admin_grant_links_account_to_league(db_session):
    season = Season(year=2029)
    league = League(sleeper_league_id="222", name="Delta League")
    season.leagues.append(league)
    db_session.add(season)
    db_session.flush()

    account = Account(email="commish@example.com", password_hash="x", role=AccountRole.LEAGUE_ADMIN)
    db_session.add(account)
    db_session.flush()

    grant = LeagueAdminGrant(account_id=account.id, league_id=league.id)
    db_session.add(grant)
    db_session.commit()

    loaded = db_session.query(LeagueAdminGrant).filter_by(account_id=account.id).one()
    assert loaded.league_id == league.id
