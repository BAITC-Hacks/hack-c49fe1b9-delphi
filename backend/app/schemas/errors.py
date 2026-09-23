from pydantic import BaseModel


class ErrorDetail(BaseModel):
    location: list[str | int]
    message: str
    type: str


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: list[ErrorDetail]
