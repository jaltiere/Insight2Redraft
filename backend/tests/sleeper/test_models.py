from app.sleeper.models import (
    NflState,
    SleeperLeague,
    SleeperMatchup,
    SleeperPlayer,
    SleeperRoster,
    SleeperUser,
)


def test_nfl_state_parses_and_ignores_extra():
    s = NflState.model_validate(
        {"season": "2024", "week": 5, "season_type": "regular", "leg": 5, "display_week": 6}
    )
    assert s.season == "2024"
    assert s.week == 5
    assert s.season_type == "regular"
    assert s.leg == 5


def test_league_keeps_scoring_settings_as_float_map():
    league = SleeperLeague.model_validate(
        {
            "league_id": "1",
            "name": "Alpha",
            "scoring_settings": {"rec": 1.0, "pass_td": 4.0},
            "roster_positions": ["QB", "RB", "WR"],
            "previous_league_id": "0",
            "irrelevant": "x",
        }
    )
    assert league.scoring_settings == {"rec": 1.0, "pass_td": 4.0}
    assert league.roster_positions == ["QB", "RB", "WR"]
    assert league.previous_league_id == "0"


def test_user_is_commissioner_from_is_owner():
    commish = SleeperUser.model_validate({"user_id": "1", "display_name": "a", "is_owner": True})
    null_owner = SleeperUser.model_validate({"user_id": "2", "display_name": "b", "is_owner": None})
    absent = SleeperUser.model_validate({"user_id": "3", "display_name": "c"})
    assert commish.is_commissioner is True
    assert null_owner.is_commissioner is False
    assert absent.is_commissioner is False


def test_roster_combines_fpts_and_decimal():
    r = SleeperRoster.model_validate(
        {
            "roster_id": 1,
            "owner_id": "u",
            "settings": {
                "wins": 10,
                "losses": 3,
                "ties": 0,
                "fpts": 1450,
                "fpts_decimal": 55,
                "fpts_against": 1300,
                "fpts_against_decimal": 20,
            },
        }
    )
    assert r.settings.wins == 10
    assert r.points_for == 1450.55
    assert r.points_against == 1300.20


def test_matchup_exposes_lineup_fields():
    m = SleeperMatchup.model_validate(
        {
            "roster_id": 1,
            "matchup_id": 2,
            "points": 120.5,
            "players": ["a", "b"],
            "starters": ["a"],
            "players_points": {"a": 10.5, "b": 4.0},
        }
    )
    assert m.starters == ["a"]
    assert m.players == ["a", "b"]
    assert m.players_points["a"] == 10.5


def test_player_parses_core_fields():
    p = SleeperPlayer.model_validate(
        {"player_id": "4046", "full_name": "Patrick Mahomes", "position": "QB", "team": "KC"}
    )
    assert p.player_id == "4046"
    assert p.full_name == "Patrick Mahomes"
    assert p.position == "QB"


def test_nfl_state_leg_defaults_to_none_when_absent():
    s = NflState.model_validate({"season": "2024", "week": 1, "season_type": "regular"})
    assert s.leg is None


def test_player_parses_first_and_last_name():
    p = SleeperPlayer.model_validate(
        {"player_id": "6794", "first_name": "Amon-Ra", "last_name": "St. Brown", "position": "WR"}
    )
    assert p.first_name == "Amon-Ra"
    assert p.last_name == "St. Brown"

