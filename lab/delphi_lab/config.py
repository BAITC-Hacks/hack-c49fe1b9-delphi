from dataclasses import dataclass
from pathlib import Path
import os
from dotenv import load_dotenv

LAB_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = LAB_ROOT.parent
load_dotenv(LAB_ROOT / '.env', override=False)


@dataclass(frozen=True)
class Settings:
    model: str = os.getenv('OPENAI_MODEL', '')
    max_calls: int = int(os.getenv('LAB_MAX_CALLS', '40'))
    max_output_tokens: int = int(os.getenv('LAB_MAX_OUTPUT_TOKENS', '5000'))
    max_input_chars: int = int(os.getenv('LAB_MAX_INPUT_CHARS', '16000'))
    max_tool_rounds: int = int(os.getenv('LAB_MAX_TOOL_ROUNDS', '4'))
    timeout_seconds: int = int(os.getenv('LAB_TIMEOUT_SECONDS', '900'))


def data_dir() -> Path:
    path = (LAB_ROOT / os.getenv('LAB_DATA_DIR', 'data')).resolve()
    if not path.is_relative_to(LAB_ROOT):
        raise ValueError('LAB_DATA_DIR must stay inside lab/')
    path.mkdir(parents=True, exist_ok=True)
    return path


def require_live_config(model: str) -> None:
    if not os.getenv('OPENAI_API_KEY'):
        raise ValueError('Set OPENAI_API_KEY in lab/.env for a live run. Never put the key in prompts.')
    if not model:
        raise ValueError('Set OPENAI_MODEL in lab/.env to a model available to your API project.')
