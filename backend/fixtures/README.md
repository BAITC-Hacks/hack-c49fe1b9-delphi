# Development seed fixtures

`users.json` defines local development accounts. The plaintext password is **not** stored in the file: `scripts/seed.py` hashes the fixed development password `password123` for every account.

| Email | Role | Password |
|---|---|---|
| `admin@delphi.local` | `admin` | `password123` |
| `analyst@delphi.local` | `analyst` | `password123` |
| `reviewer@delphi.local` | `reviewer` | `password123` |

These are deliberately weak, local-only demo credentials. Do not deploy them, reuse their password, or add a real user to this fixture.

`demo_analysis.json` points to the supplied revision 8 DOCX and revision 9 Markdown export. The seed script parses and copies them using the same parser and storage rules as the upload route. It does not seed AI findings: a finding must come from a real run and carry valid evidence.

Run the checks without touching the database:

```sh
cd backend
uv run python scripts/seed.py --check
```

After configuring PostgreSQL and running migrations, seed the database:

```sh
cd backend
uv run alembic upgrade head
uv run python scripts/seed.py
```
