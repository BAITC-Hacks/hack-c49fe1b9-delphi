import json
import re
from collections.abc import Iterable

from .models import AgentError, FunctionOutput, SourceInput


def normalize(text: str) -> str:
    return " ".join(re.findall(r"\w+", text.casefold()))


def tool_schema(name: str, description: str, properties: dict) -> dict:
    return {
        "type": "function",
        "name": name,
        "description": description,
        "strict": True,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": list(properties),
            "additionalProperties": False,
        },
    }


TOOLS = [
    tool_schema(
        "search_clauses",
        "Lexical search in this run. Not proof of absence.",
        {
            "side": {"type": "string", "enum": ["before", "after"]},
            "query": {"type": "string"},
            "offset": {"type": "integer", "minimum": 0},
        },
    ),
    tool_schema(
        "get_clause",
        "Read original source text and parent context.",
        {
            "source_id": {"type": "string"},
        },
    ),
    tool_schema(
        "get_unit_functions",
        "Read a unit's functions in this run, 20 per page.",
        {
            "side": {"type": "string", "enum": ["before", "after"]},
            "unit_id": {"type": "string"},
            "offset": {"type": "integer", "minimum": 0},
        },
    ),
]


class SourceTools:
    def __init__(self, sources: Iterable[SourceInput], functions: list[FunctionOutput]):
        items = list(sources)
        self.sources = {source.id: source for source in items}
        if len(self.sources) != len(items):
            raise AgentError("Duplicate source IDs")
        self.functions = functions
        self.operations: list[dict] = []

    def call(self, name: str, arguments: str) -> str:
        try:
            args = json.loads(arguments)
        except (TypeError, ValueError) as exc:
            raise AgentError("Invalid tool arguments") from exc
        if not isinstance(args, dict):
            raise AgentError("Tool arguments must be an object")
        if name == "get_clause":
            self._keys(args, {"source_id"})
            if not isinstance(args["source_id"], str):
                raise AgentError("Source ID must be a string")
            source = self.sources.get(args["source_id"])
            if source is None:
                raise AgentError("Unknown source ID in get_clause")
            result = source.model_dump()
            trace = {"tool": name, "source_ids": [source.id]}
        elif name == "search_clauses":
            self._keys(args, {"side", "query", "offset"})
            self._page(args)
            if not isinstance(args["query"], str) or not args["query"].strip():
                raise AgentError("Search query cannot be empty")
            words = set(normalize(args["query"]).split())
            ranked = []
            for source in self.sources.values():
                if source.side != args["side"]:
                    continue
                score = len(words & set(normalize(source.text).split()))
                if score:
                    ranked.append((score, source))
            ranked.sort(key=lambda item: (-item[0], item[1].id))
            offset = args["offset"]
            selected = [source for _, source in ranked[offset : offset + 12]]
            result = {
                "matches": [
                    {"id": source.id, "clause_no": source.clause_no, "excerpt": source.text[:1200]}
                    for source in selected
                ],
                "total_matches": len(ranked),
                "offset": offset,
                "has_more": offset + 12 < len(ranked),
                "method": "lexical",
            }
            trace = {
                "tool": name,
                "side": args["side"],
                "query": args["query"],
                "source_ids": [source.id for source in selected],
            }
        elif name == "get_unit_functions":
            self._keys(args, {"side", "unit_id", "offset"})
            self._page(args)
            if not isinstance(args["unit_id"], str):
                raise AgentError("Unit ID must be a string")
            known = {unit_id for function in self.functions for unit_id in function.owner_unit_ids}
            if args["unit_id"] not in known:
                raise AgentError("Unknown unit ID in get_unit_functions")
            matches = [
                function
                for function in self.functions
                if function.side == args["side"] and args["unit_id"] in function.owner_unit_ids
            ]
            if not matches:
                raise AgentError("Unit belongs to the other comparison side")
            offset = args["offset"]
            selected = matches[offset : offset + 20]
            result = {
                "functions": [function.model_dump() for function in selected],
                "total": len(matches),
                "has_more": offset + 20 < len(matches),
            }
            trace = {
                "tool": name,
                "unit_id": args["unit_id"],
                "function_ids": [function.id for function in selected],
            }
        else:
            raise AgentError(f"Unknown tool: {name}")
        self.operations.append(trace)
        return json.dumps(result, ensure_ascii=False)

    @staticmethod
    def _keys(args: dict, expected: set[str]) -> None:
        if set(args) != expected:
            raise AgentError("Invalid tool argument names")

    @staticmethod
    def _page(args: dict) -> None:
        if args["side"] not in {"before", "after"}:
            raise AgentError("Invalid comparison side")
        if type(args["offset"]) is not int or args["offset"] < 0:
            raise AgentError("Invalid tool page offset")
