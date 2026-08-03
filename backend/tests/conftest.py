import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401  (registers all tables on Base.metadata)
from app.config import settings
from app.models.base import Base
from app.models import League, Owner, Season, SeasonStatus, Team, WeeklyScore


@pytest.fixture(scope="session")
def engine():
    eng = create_engine(settings.test_database_url, future=True)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture()
def db_session(engine):
    connection = engine.connect()
    transaction = connection.begin()
    TestSession = sessionmaker(bind=connection, expire_on_commit=False)
    session: Session = TestSession()
    try:
        yield session
    finally:
        session.close()
        if transaction.is_active:
            transaction.rollback()
        connection.close()


@pytest.fixture()
def seed(db_session):
    """Factory helpers for read-layer test data. Each call adds + flushes."""

    class _Seed:
        def __init__(self, session):
            self.s = session
            self._n = 0

        def _next(self) -> int:
            self._n += 1
            return self._n

        def owner(self, first_name="Jack", last_name="Altiere", **kw) -> Owner:
            o = Owner(first_name=first_name, last_name=last_name, **kw)
            self.s.add(o)
            self.s.flush()
            return o

        def season(self, year, status=SeasonStatus.REGULAR, **kw) -> Season:
            se = Season(year=year, status=status, **kw)
            self.s.add(se)
            self.s.flush()
            return se

        def league(self, season, name="League", scoring_validated=False, **kw) -> League:
            kw.setdefault("sleeper_league_id", str(self._next()))
            lg = League(
                season_id=season.id,
                name=name,
                scoring_validated=scoring_validated,
                **kw,
            )
            self.s.add(lg)
            self.s.flush()
            return lg

        def team(self, league, owner=None, wins=0, losses=0, ties=0,
                 points_for=0, points_against=0, league_finish=None, **kw) -> Team:
            t = Team(
                league_id=league.id,
                sleeper_roster_id=self._next(),
                owner_id=(owner.id if owner is not None else None),
                wins=wins, losses=losses, ties=ties,
                points_for=points_for, points_against=points_against,
                league_finish=league_finish, **kw,
            )
            self.s.add(t)
            self.s.flush()
            return t

        def weekly(self, team, week, sleeper_points, recomputed_points=None,
                   bench_points=None, mismatch_flag=False, is_final=False) -> WeeklyScore:
            ws = WeeklyScore(
                team_id=team.id, week=week, sleeper_points=sleeper_points,
                recomputed_points=recomputed_points, bench_points=bench_points,
                mismatch_flag=mismatch_flag, is_final=is_final,
            )
            self.s.add(ws)
            self.s.flush()
            return ws

    return _Seed(db_session)
