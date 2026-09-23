"""Version prompt instructions without storing document content or credentials."""
from hashlib import sha256
import json

from .config import LAB_ROOT


def prompt_manifest() -> dict:
    files = {path.name: sha256(path.read_bytes()).hexdigest()
             for path in sorted((LAB_ROOT / 'prompts').glob('*.md')) if path.name != 'README.md'}
    return {'sha256': sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(), 'files': files}
