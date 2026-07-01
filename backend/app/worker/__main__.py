import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.sleeper.client import SleeperClient
from app.worker.cycle import PlayersSyncState
from app.worker.runner import run


def create_session_factory() -> sessionmaker:
    engine = create_engine(settings.database_url, future=True)
    return sessionmaker(bind=engine)


def utc_clock() -> datetime:
    return datetime.now(timezone.utc)


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    session_factory = create_session_factory()
    client = SleeperClient()
    try:
        await run(
            client,
            session_factory,
            utc_clock,
            asyncio.sleep,
            lambda: True,
            players_state=PlayersSyncState(),
        )
    finally:
        await client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
