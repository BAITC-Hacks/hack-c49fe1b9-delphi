"""Exercise SDK schema parsing against local HTTP responses, without API calls."""

import json

import httpx
import pytest
from openai import AsyncOpenAI

from app.agent.model_client import ModelClient
from app.agent.models import AgentError, Comparison, OutputLimit


def response_body(text, *, status="completed", reason=None):
    return {
        "id": "resp_synthetic",
        "object": "response",
        "created_at": 0,
        "model": "test-model",
        "status": status,
        "incomplete_details": {"reason": reason} if reason else None,
        "output": [
            {
                "id": "msg_synthetic",
                "type": "message",
                "role": "assistant",
                "status": status,
                "content": [{"type": "output_text", "text": text, "annotations": []}],
            }
        ],
        "parallel_tool_calls": False,
        "tool_choice": "auto",
        "tools": [],
    }


@pytest.mark.parametrize(
    "status,reason,error_type,message",
    [
        ("incomplete", "max_output_tokens", OutputLimit, "output token limit"),
        ("incomplete", "content_filter", AgentError, "no completed result"),
        ("completed", None, AgentError, "invalid structured response"),
    ],
)
async def test_truncated_json_checks_completion_status_before_sdk_schema_parsing(
    status, reason, error_type, message
):
    body = response_body('{"reviewed_function_ids":[', status=status, reason=reason)
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=body))
    async with AsyncOpenAI(
        api_key="synthetic-key", http_client=httpx.AsyncClient(transport=transport)
    ) as client:
        model = ModelClient(client, "test-model", 5, 0)
        with pytest.raises(error_type, match=message) as raised:
            await model.request("test", {}, Comparison)
        assert type(raised.value) is error_type


async def test_completed_response_keeps_strict_schema_and_configured_output_limit():
    requests = []
    expected = Comparison(reviewed_function_ids=[], findings=[])

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=response_body(expected.model_dump_json()))

    async with AsyncOpenAI(
        api_key="synthetic-key",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    ) as client:
        model = ModelClient(client, "test-model", 5, 0, max_output_tokens=12000)
        assert await model.request("test", {}, Comparison) == expected
    assert len(requests) == 1
    assert requests[0]["max_output_tokens"] == 12000
    assert requests[0]["text"]["format"]["strict"] is True
    assert requests[0]["text"]["format"]["name"] == "Comparison"
