from datetime import date, datetime
from io import BytesIO

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

from .types import TextChunk


def _text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def read_xlsx(content: bytes) -> tuple[list[TextChunk], list[str]]:
    workbook = load_workbook(BytesIO(content), read_only=True, data_only=False, keep_links=False)
    chunks = []
    warnings = []
    try:
        for sheet in workbook:
            sheet.reset_dimensions()
            headers = None
            header_row = None
            for number, row in enumerate(sheet.iter_rows(), 1):
                values = [_text(cell.value) for cell in row]
                if not any(values):
                    continue
                while values and not values[-1]:
                    values.pop()
                if headers is None:
                    headers = values
                    header_row = number
                if any(cell.data_type == "f" for cell in row):
                    warnings.append(f"xlsx_formulas_not_evaluated:{sheet.title}:{number}")
                locator = {
                    "sheet": sheet.title,
                    "row": number,
                    "range": f"A{number}:{get_column_letter(len(values))}{number}",
                    "headers": headers,
                    "header_row": header_row,
                    "cells": {
                        f"{get_column_letter(index)}{number}": value
                        for index, value in enumerate(values, 1)
                    },
                }
                chunks.append(
                    TextChunk(f"sheet:{sheet.title}:row:{number}", "\t".join(values), locator)
                )
    finally:
        workbook.close()
    return chunks, warnings
