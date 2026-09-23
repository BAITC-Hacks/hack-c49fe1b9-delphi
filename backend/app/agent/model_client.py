from json import JSONDecodeError
from typing import TypeVar

from openai import AsyncOpenAI, OpenAIError
from pydantic import BaseModel, ValidationError

from .common import serialized
from .models import AgentError, OutputLimit
from .tools import TOOLS, SourceTools

Result = TypeVar("Result", bound=BaseModel)


class ModelClient:
    def __init__(
        self,
        client: AsyncOpenAI,
        model: str,
        request_timeout_seconds: float,
        max_tool_rounds: int,
        max_input_chars: int = 24000,
        *,
        max_output_tokens: int = 5000,
    ):
        self.client = client
        self.model = model
        self.request_timeout_seconds = request_timeout_seconds
        self.max_tool_rounds = max_tool_rounds
        self.max_input_chars = max_input_chars
        self.max_output_tokens = max_output_tokens

    async def request(
        self,
        instructions: str,
        payload: dict,
        result_type: type[Result],
        tools: SourceTools | None = None,
    ) -> Result:
        content = serialized(payload)
        if len(content) > self.max_input_chars:
            raise AgentError(
                "Request exceeds the configured character limit; no input was truncated"
            )
        messages: list = [{"role": "user", "content": content}]
        for round_index in range(self.max_tool_rounds + 1):
            if len(serialized(messages)) > self.max_input_chars * (self.max_tool_rounds + 2):
                raise AgentError("Tool context exceeds the configured character limit")
            options = (
                {
                    "tools": TOOLS,
                    "parallel_tool_calls": False,
                    "tool_choice": "none" if round_index == self.max_tool_rounds else "auto",
                }
                if tools
                else {}
            )
            try:
                raw_response = await self.client.responses.with_raw_response.parse(
                    model=self.model,
                    instructions=instructions,
                    input=messages,
                    text_format=result_type,
                    store=False,
                    max_output_tokens=self.max_output_tokens,
                    include=["reasoning.encrypted_content"],
                    timeout=self.request_timeout_seconds,
                    **options,
                )
                # The SDK parses output JSON before exposing status. A truncated
                # result must trigger batch splitting before schema validation.
                envelope = raw_response.http_response.json()
                if not isinstance(envelope, dict):
                    raise AgentError("Model returned an invalid structured response")
                status = envelope.get("status")
                if status != "completed":
                    details = envelope.get("incomplete_details")
                    reason = details.get("reason") if isinstance(details, dict) else None
                    if status == "incomplete" and reason == "max_output_tokens":
                        raise OutputLimit("Model response is incomplete: output token limit")
                    raise AgentError(f"Model response is {status}; no completed result")
                response = raw_response.parse()
            except OpenAIError as exc:
                raise AgentError(f"Model request failed ({type(exc).__name__})") from exc
            except (ValidationError, JSONDecodeError) as exc:
                raise AgentError("Model returned an invalid structured response") from exc
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
