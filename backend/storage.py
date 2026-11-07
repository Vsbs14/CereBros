import json
from pathlib import Path
import sqlite3

import numpy as np


class Store:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.executescript('''
                CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, body TEXT NOT NULL);
            ''')

    def connection(self):
        return sqlite3.connect(self.root / "neurolingo.sqlite3", timeout=30)

    def put(self, table, entity):
        assert table in {"students", "sessions"}
        with self.connection() as conn:
            conn.execute(f"INSERT OR REPLACE INTO {table} VALUES (?, ?)", (entity["id"], json.dumps(entity, allow_nan=False)))

    def get(self, table, identifier):
        assert table in {"students", "sessions"}
        with self.connection() as conn:
            row = conn.execute(f"SELECT body FROM {table} WHERE id = ?", (identifier,)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, table):
        assert table in {"students", "sessions"}
        with self.connection() as conn:
            rows = conn.execute(f"SELECT body FROM {table} ORDER BY rowid DESC").fetchall()
        return [json.loads(row[0]) for row in rows]

    def save_recording(self, identifier, timestamps, samples):
        # Only server-generated UUIDs reach filenames.
        dest = self.root / f"{identifier}.npz"
        partial = self.root / f"{identifier}.partial.npz"
        np.savez_compressed(partial, timestamps=timestamps, samples=samples)
        partial.replace(dest)

    def recording(self, identifier):
        path = self.root / f"{identifier}.npz"
        if not path.exists():
            return np.empty(0), np.empty((0, 8))
        with np.load(path, allow_pickle=False) as archive:
            return archive["timestamps"], archive["samples"]
