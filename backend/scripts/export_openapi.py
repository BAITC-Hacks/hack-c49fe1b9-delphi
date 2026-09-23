import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.main import create_app  # noqa: E402


def main() -> None:
    schema = create_app().openapi()
    operations = [
        operation["operationId"]
        for path in schema["paths"].values()
        for method, operation in path.items()
        if method in {"get", "post", "put", "patch", "delete", "options", "head"}
    ]
    if len(operations) != len(set(operations)):
        raise ValueError("OpenAPI operation IDs must be unique")
    destination = BACKEND_DIR / "openapi.json"
    destination.write_text(
        json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Exported {len(operations)} operations to {destination.name}; no database or AI calls")


if __name__ == "__main__":
    main()
