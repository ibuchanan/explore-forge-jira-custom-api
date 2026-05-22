#!/usr/bin/env python3
"""Validate webtrigger Hurl environment before running integration tests."""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import urlparse

ENV_FILE = Path("integration/webtrigger/.env.hurl")
REQUIRED_URL_KEYS = (
    "webtrigger_url",
    "webtrigger_as_user_url",
    "webtrigger_upsert_url",
    "webtrigger_upsert_as_user_url",
)


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        raise RuntimeError(
            f"Missing {path}. Copy integration/webtrigger/.env.hurl.example to {path} "
            "and fill in the webtrigger URLs from `npm run forge:webtrigger:list`."
        )

    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def is_valid_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def is_placeholder(value: str) -> bool:
    lowered = value.lower()
    return not value or "<" in value or ">" in value or "paste " in lowered or "forge webtrigger list" in lowered


def main() -> int:
    values = read_env(ENV_FILE)
    errors: list[str] = []

    for key in REQUIRED_URL_KEYS:
        value = values.get(key, "")
        if is_placeholder(value) or not is_valid_url(value):
            errors.append(f"- {key} must be replaced with the matching URL from `npm run forge:webtrigger:list`.")

    if errors:
        print(f"Error: {ENV_FILE} still has missing or placeholder webtrigger URLs.", file=sys.stderr)
        print("", file=sys.stderr)
        print("Run:", file=sys.stderr)
        print("  npm run forge:webtrigger:list", file=sys.stderr)
        print("", file=sys.stderr)
        print("Then copy each trigger URL into integration/webtrigger/.env.hurl:", file=sys.stderr)
        for error in errors:
            print(error, file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
