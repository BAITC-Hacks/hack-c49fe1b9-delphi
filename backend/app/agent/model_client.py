from typing import TypeVar

from openai import AsyncOpenAI, OpenAIError
from pydantic import BaseModel

from .common import serialized
from .models import AgentError
from .tools import TOOLS, SourceTools

Result = TypeVar("Result", bound=BaseModel)


class ModelClient:
    def __init__(
        self, client: AsyncOpenAI, model: str, request_timeout_seconds: float, max_tool_rounds: int
    ):
        self.client = client
        self.model = model
        self.request_timeout_seconds = request_timeout_seconds
        self.max_tool_rounds = max_tool_rounds

    async def request(
        self,
        instructions: str,
        payload: dict,
        result_type: type[Result],
        tools: SourceTools | None = None,
    ) -> Result:
        messages: list = [{"role": "user", "content": serialized(payload)}]
        for round_index in range(self.max_tool_rounds + 1):
            options = {"tools": TOOLS, "parallel_tool_calls": False} if tools else {}
            try:
                response = await self.client.responses.parse(
                    model=self.model,
                    instructions=instructions,
                    input=messages,
                    text_format=result_type,
                    store=False,
                    timeout=self.request_timeout_seconds,
                    **options,
                )
            except OpenAIError as exc:
                raise AgentError(f"Model request failed ({type(exc).__name__})") from exc
            if response.status != "completed":
                raise AgentError(f"Model response is {response.status}; no completed result")
            calls = [item for item in response.output if item.type == "function_call"]
            if calls:
                if tools is None or round_index == self.max_tool_rounds:
                    raise AgentError("Agent tool round limit reached before a final result")
                messages.extend(item.model_dump(exclude_none=True) for item in response.output)
                for call in calls:
                    output = tools.call(call.name, call.arguments)
                    messages.append(
                        {"type": "function_call_output", "call_id": call.call_id, "output": output}
                    )
                continue
            if response.output_parsed is None:
                raise AgentError("Model refused or returned no structured result")
            if not isinstance(response.output_parsed, result_type):
                raise AgentError("Unexpected structured result type")
            return response.output_parsed
        raise AgentError("Agent did not produce a result")
