import subprocess

from sqlalchemy import create_engine, inspect, text

from app.config import settings

EXPECTED_ENUM_LABELS = {
    "account_role": {"super_admin", "league_admin"},
    "season_status": {"setup", "regular", "playoffs", "complete"},
    "bracket_status": {"pending", "active", "complete"},
    "qualified_via": {"auto", "wildcard"},
}

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


def test_migration_creates_lowercase_enum_labels():
    """Production DDL must define each enum type with the spec's lowercase tokens."""
    _run("downgrade", "base")
    _run("upgrade", "head")

    engine = create_engine(settings.database_url, future=True)
    with engine.connect() as conn:
        for type_name, expected in EXPECTED_ENUM_LABELS.items():
            labels = set(
                conn.execute(
                    text(
                        "SELECT e.enumlabel FROM pg_enum e "
                        "JOIN pg_type t ON t.oid = e.enumtypid "
                        "WHERE t.typname = :name"
                    ),
                    {"name": type_name},
                ).scalars()
            )
            assert labels == expected, f"{type_name}: {labels} != {expected}"
    engine.dispose()


def test_migration_downgrade_drops_app_tables():
    _run("downgrade", "base")

    engine = create_engine(settings.database_url, future=True)
    tables = set(inspect(engine).get_table_names())
    engine.dispose()

    leftover = EXPECTED_TABLES & tables
    assert not leftover, f"tables not dropped after downgrade: {leftover}"

    _run("upgrade", "head")  # restore for subsequent use
