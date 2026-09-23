from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Side = Literal["before", "after"]
Locale = Literal["ru", "kk", "en"]
ReviewStatus = Literal["unreviewed", "confirmed", "needs_clarification", "rejected"]


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CreateAnalysis(RequestModel):
    title: str = Field(min_length=1, max_length=200)


class PatchDocument(RequestModel):
    side: Side | None = None
    revision_label: str | None = Field(default=None, max_length=100)


class StartRun(RequestModel):
    output_language: Locale
    allow_partial: bool


class UpdateReview(RequestModel):
    model_config = ConfigDict(str_strip_whitespace=False)

    status: ReviewStatus
    note: str = Field(max_length=4000)


class TranslateRequest(RequestModel):
    locale: Locale


class TranslatedFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    title: str
    explanation: str
    recommendation: str


class TranslatedStructure(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    explanation: str


class TranslatedPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    findings: list[TranslatedFinding]
    summary: str
    structure: list[TranslatedStructure] = Field(default_factory=list)
