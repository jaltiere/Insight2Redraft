class SleeperError(Exception):
    """Base error for the Sleeper API client."""


class SleeperNotFound(SleeperError):
    """Raised on HTTP 404 (e.g. an unknown league id). Never retried."""


class SleeperUnavailable(SleeperError):
    """Raised when the Sleeper API stays unreachable after retries (5xx / connection)."""
