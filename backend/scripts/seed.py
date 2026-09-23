#!/usr/bin/env python3
"""Seed local Delphi demo accounts and the official comparison document pair.

Run from the backend directory:

    uv run alembic upgrade head
    uv run python scripts/seed.py

Use ``--check`` to validate fixture shape and source documents without opening
the database. The command is idempotent: existing fixture users are reset to
the documented development password and duplicate source documents are skipped.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import secrets
import shutil
import sys
from pathlib import Path
from uuid import uuid4, uuid5

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPOSITORY_DIR = BACKEND_DIR.parent
FIXTURES_DIR = BACKEND_DIR / "fixtures"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.exc import ProgrammingError  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import create_database  # noqa: E402
from app.models import Analysis, Document, Run, SourceBlock, User  # noqa: E402
from app.parsers import ParseError, parse_document  # noqa: E402

DEMO_PASSWORD = "password123"
ALLOWED_ROLES = {"admin", "analyst", "reviewer"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class FixtureError(ValueError):
    """A fixture is unsafe or does not conform to the small seed contract."""


def read_json(filename: str) -> dict:
    path = FIXTURES_DIR / filename
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FixtureError(f"Cannot read {path.relative_to(REPOSITORY_DIR)}: {exc}") from exc
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        raise FixtureError(f"{filename} must be an object with schema_version 1")
    return value


def validate_users(value: dict) -> list[dict[str, str]]:
    if set(value) != {"schema_version", "users"} or not isinstance(value["users"], list):
        raise FixtureError("users.json must contain only schema_version and users")
    users: list[dict[str, str]] = []
    emails: set[str] = set()
    for index, user in enumerate(value["users"], start=1):
        if not isinstance(user, dict) or set(user) != {"email", "display_name", "role"}:
            raise FixtureError(f"users.json user {index} has unexpected fields")
        if not all(isinstance(user[field], str) and user[field].strip() for field in user):
            raise FixtureError(f"users.json user {index} has an empty value")
        email = user["email"].strip().lower()
        if not EMAIL_RE.fullmatch(email):
            raise FixtureError(f"users.json user {index} has an invalid email")
        if email in emails:
            raise FixtureError(f"users.json repeats email {email}")
        if user["role"] not in ALLOWED_ROLES:
            raise FixtureError(f"users.json user {index} has an unsupported role")
        emails.add(email)
        users.append(
            {
                "email": email,
                "display_name": user["display_name"].strip(),
                "role": user["role"],
            }
        )
    if not users:
        raise FixtureError("users.json must define at least one user")
    return users


def safe_source_path(relative_path: str) -> Path:
    if not isinstance(relative_path, str) or not relative_path:
        raise FixtureError("demo document source_path must be a non-empty string")
    candidate = (REPOSITORY_DIR / relative_path).resolve()
    try:
        candidate.relative_to(REPOSITORY_DIR)
    except ValueError as exc:
        raise FixtureError("demo document source_path must stay inside the repository") from exc
    if not candidate.is_file():
        raise FixtureError(f"Demo source does not exist: {relative_path}")
    return candidate


def validate_demo(value: dict) -> tuple[str, list[dict[str, str]]]:
    if set(value) != {"schema_version", "analysis", "documents"}:
        raise FixtureError("demo_analysis.json has unexpected fields")
    analysis = value["analysis"]
    documents = value["documents"]
    if not isinstance(analysis, dict) or set(analysis) != {"title"}:
        raise FixtureError("demo_analysis.json analysis must contain only title")
    title = analysis["title"].strip() if isinstance(analysis["title"], str) else ""
    if not title or len(title) > 200:
        raise FixtureError("demo analysis title must contain 1 to 200 characters")
    if not isinstance(documents, list) or len(documents) != 2:
        raise FixtureError("demo_analysis.json must define exactly two documents")
    result: list[dict[str, str]] = []
    sides: set[str] = set()
    for index, document in enumerate(documents, start=1):
        if not isinstance(document, dict) or set(document) != {
            "side",
            "source_path",
            "revision_label",
        }:
            raise FixtureError(f"demo document {index} has unexpected fields")
        side = document["side"]
        revision_label = document["revision_label"]
        if side not in {"before", "after"} or side in sides:
            raise FixtureError("demo documents must have one before side and one after side")
        if not isinstance(revision_label, str) or not revision_label.strip():
            raise FixtureError(f"demo document {index} has an invalid revision_label")
        source = safe_source_path(document["source_path"])
        suffix = source.suffix.lower()
        if suffix not in {".md", ".docx", ".pdf", ".xlsx"}:
            raise FixtureError(f"demo document {index} has an unsupported format")
        sides.add(side)
        result.append(
            {
                "side": side,
                "source_path": str(source),
                "revision_label": revision_label.strip(),
            }
        )
    return title, result


def password_hash(password: str) -> str:
    """Return a self-describing scrypt hash; never persist the plaintext password."""
    salt = secrets.token_bytes(16)
    n, r, p = 16_384, 8, 1
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p)
    return f"scrypt${n}${r}${p}${salt.hex()}${derived.hex()}"


def parsed_document(source: Path, max_uncompressed_bytes: int):
    try:
        return parse_document(
            source.name,
            source.read_bytes(),
            max_uncompressed_bytes=max_uncompressed_bytes,
        )
    except ParseError as exc:
        raise FixtureError(
            f"Cannot parse {source.relative_to(REPOSITORY_DIR)}: {exc.message}"
        ) from exc


async def seed_database(
    users: list[dict[str, str]], title: str, documents: list[dict[str, str]]
) -> None:
    settings = get_settings()
    parsed = [
        (document, parsed_document(Path(document["source_path"]), settings.max_uncompressed_bytes))
        for document in documents
    ]
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    engine, session_factory = create_database(settings.database_url)
    created_files: list[Path] = []
    try:
        async with session_factory() as session:
            for definition in users:
                user = await session.scalar(select(User).where(User.email == definition["email"]))
                if user is None:
                    session.add(
                        User(
                            **definition, password_hash=password_hash(DEMO_PASSWORD), is_active=True
                        )
                    )
                else:
                    user.display_name = definition["display_name"]
                    user.role = definition["role"]
                    user.password_hash = password_hash(DEMO_PASSWORD)
                    user.is_active = True

            analysis = await session.scalar(
                select(Analysis)
                .where(Analysis.title == title)
                .order_by(Analysis.created_at)
                .limit(1)
                .with_for_update()
            )
            if analysis is None:
                analysis = Analysis(title=title)
                session.add(analysis)
                await session.flush()
            existing_run = await session.scalar(
                select(Run.id).where(Run.analysis_id == analysis.id)
            )

            for definition, parsed_result in parsed:
                source = Path(definition["source_path"])
                content = source.read_bytes()
                digest = hashlib.sha256(content).hexdigest()
                existing = await session.scalar(
                    select(Document).where(
                        Document.analysis_id == analysis.id,
                        Document.side == definition["side"],
                        Document.hash == digest,
                    )
                )
                if existing is not None:
                    continue
                if existing_run is not None:
                    raise FixtureError(
                        "Demo documents cannot change after an analysis run exists. "
                        "Create a new comparison before adding documents."
                    )
                document_id = uuid4()
                storage_key = f"{document_id}{source.suffix.lower()}"
                destination = settings.storage_path / storage_key
                shutil.copyfile(source, destination)
                created_files.append(destination)
                document = Document(
                    id=document_id,
                    analysis_id=analysis.id,
                    side=definition["side"],
                    filename=source.name,
                    storage_key=storage_key,
                    hash=digest,
                    revision_label=definition["revision_label"],
                    format=source.suffix.lower().removeprefix("."),
                    detected_language=parsed_result.detected_language,
                    parse_status="partial"
                    if any(
                        not warning.startswith("table_of_contents_skipped:")
                        for warning in parsed_result.warnings
                    )
                    else "parsed",
                    warnings=parsed_result.warnings,
                )
                session.add(document)
                await session.flush()
                source_ids = {
                    block.key: uuid5(document_id, block.key) for block in parsed_result.blocks
                }
                for index, block in enumerate(parsed_result.blocks):
                    session.add(
                        SourceBlock(
                            id=source_ids[block.key],
                            document_id=document_id,
                            clause_no=block.clause_no,
                            parent_id=None,
                            locator={**block.locator, "block_index": index},
                            original_text=block.original_text,
                            normalized_text=block.normalized_text,
                        )
                    )
                await session.flush()
                for block in parsed_result.blocks:
                    if block.parent_key is not None:
                        source_block = await session.get(SourceBlock, source_ids[block.key])
                        source_block.parent_id = source_ids[block.parent_key]

            await session.commit()
    except ProgrammingError as exc:
        for created in created_files:
            created.unlink(missing_ok=True)
        raise FixtureError(
            "Database tables are missing. Run `uv run alembic upgrade head` before seeding."
        ) from exc
    except Exception:
        for created in created_files:
            created.unlink(missing_ok=True)
        raise
    finally:
        await engine.dispose()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate fixtures and parse the supplied documents without writing to PostgreSQL.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    users = validate_users(read_json("users.json"))
    title, documents = validate_demo(read_json("demo_analysis.json"))
    for document in documents:
        parsed_document(Path(document["source_path"]), max_uncompressed_bytes=52_428_800)
    if args.check:
        print(
            f"Fixtures are valid: {len(users)} development users and "
            f"{len(documents)} official comparison documents."
        )
        return
    asyncio.run(seed_database(users, title, documents))
    print(
        f"Seeded {len(users)} development users (password: {DEMO_PASSWORD}) and demo analysis: {title}"
    )


if __name__ == "__main__":
    main()
