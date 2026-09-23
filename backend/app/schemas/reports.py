from uuid import UUID

from pydantic import BaseModel

from app.schemas.common import Locale, TranslatedPayload


class TranslationResponse(BaseModel):
    run_id: UUID
    review_revision: int
    locale: Locale
    payload: TranslatedPayload
    cached: bool
