"""OS-held process lock; a crashed process releases it automatically."""
import os
from .config import data_dir


class RuntimeLock:
    def __init__(self):
        self.handle = None

    def acquire(self):
        handle = (data_dir() / '.runtime.lock').open('a+b')
        if handle.seek(0, 2) == 0:
            handle.write(b'0')
            handle.flush()
        handle.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            raise ValueError('Another lab process is active. Use its API or stop it before starting the CLI/server.') from None
        self.handle = handle

    def release(self):
        if self.handle is not None:
            self.handle.close()
            self.handle = None
