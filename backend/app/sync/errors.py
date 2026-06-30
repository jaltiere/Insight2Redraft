class SyncError(Exception):
    """A sync-level failure (e.g. operating on a league row that does not exist)."""
