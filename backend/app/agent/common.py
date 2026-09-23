import json
from collections.abc import Sequence
from uuid import NAMESPACE_URL, uuid5

from pydantic import BaseModel

from .models import AgentError


def stable_id(kind: str, *parts: object) -> str:
    return str(
        uuid5(
            NAMESPACE_URL, json.dumps(["delphi", kind, *parts], ensure_ascii=False, sort_keys=True)
        )
    )


def serialized(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def batches[Item: BaseModel](items: Sequence[Item], limit: int) -> list[list[Item]]:
    result: list[list[Item]] = []
    current: list[Item] = []
    size = 2
    for item in items:
        length = len(item.model_dump_json()) + 1
        if length + 2 > limit:
            raise AgentError("An analysis item exceeds the configured batch character limit")
        if current and size + length > limit:
            result.append(current)
            current, size = [], 2
        current.append(item)
        size += length
    if current:
        result.append(current)
    return result
