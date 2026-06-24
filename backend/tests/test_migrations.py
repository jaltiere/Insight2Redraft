import subprocess

from sqlalchemy import create_engine, inspect

from app.config import settings

EXPECTED_TABLES = {
    "owner",
    "owner_sleeper_link",
    "account",
    "league_admin_grant",
    "scoring_ruleset",
    "season",
    "league",
    "team",
    "weekly_score",
    "player",
    "player_stat_cache",
    "bracket",
    "bracket_seed",
    "bracket_matchup",
}


def _run(*args: str) -> None:
    result = subprocess.run(
        ["uv", "run", "alembic", *args],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_migration_upgrade_creates_all_tables():
    _run("downgrade", "base")
    _run("upgrade", "head")

    engine = create_engine(settings.database_url, future=True)
    tables = set(inspect(engine).get_table_names())
    engine.dispose()

    missing = EXPECTED_TABLES - tables
    assert not missing, f"missing tables after upgrade: {missing}"


def test_migration_downgrade_drops_app_tables():
    _run("downgrade", "base")

    engine = create_engine(settings.database_url, future=True)
    tables = set(inspect(engine).get_table_names())
    engine.dispose()

    leftover = EXPECTED_TABLES & tables
    assert not leftover, f"tables not dropped after downgrade: {leftover}"

    _run("upgrade", "head")  # restore for subsequent use
