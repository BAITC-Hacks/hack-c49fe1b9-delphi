from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from .documents import DocumentResponse
from .runs import RunResponse, RunState


class AnalysisResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    created_at: datetime


class AnalysisListItem(AnalysisResponse):
    run_id: UUID | None
    state: RunState | Literal["draft"]


class AnalysisDetail(AnalysisResponse):
    documents: list[DocumentResponse]
    run: RunResponse | None
