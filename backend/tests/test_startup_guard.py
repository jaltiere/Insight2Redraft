"""
Tests for JWT secret startup guard in production.
Ensures that the app fails loudly if jwt_secret is still the dev default in production.
"""

import os
import pytest
from app.config import settings
from app.main import create_app


def test_startup_guard_raises_in_production_with_dev_default(monkeypatch):
    """
    Test that create_app() raises RuntimeError when ENVIRONMENT=production
    and jwt_secret is the dev default.
    """
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "jwt_secret", "dev-insecure-change-me")

    with pytest.raises(RuntimeError) as exc_info:
        create_app()

    assert "JWT_SECRET" in str(exc_info.value)


def test_startup_guard_allows_production_with_real_secret(monkeypatch):
    """
    Test that create_app() does NOT raise when ENVIRONMENT=production
    but jwt_secret is a real secret (not the dev default).
    """
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "jwt_secret", "a-real-secret-value-at-least-32-bytes-long-for-jwt")

    # Should not raise
    app = create_app()
    assert app is not None


def test_startup_guard_allows_non_production_with_dev_default(monkeypatch):
    """
    Test that create_app() does NOT raise when ENVIRONMENT is unset/development
    even with the dev-default secret.
    """
    # Test with ENVIRONMENT unset
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setattr(settings, "jwt_secret", "dev-insecure-change-me")

    # Should not raise
    app = create_app()
    assert app is not None

    # Clean up for next test in this function
    # Reset settings for the next part of the test
    monkeypatch.setattr(settings, "jwt_secret", "dev-insecure-change-me")
    monkeypatch.setenv("ENVIRONMENT", "development")

    # Should not raise for development either
    app = create_app()
    assert app is not None
