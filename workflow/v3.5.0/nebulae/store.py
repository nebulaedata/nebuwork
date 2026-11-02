"""Version-one persistence, independent of HTTP and execution."""
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import time

class Conflict(ValueError):
    """A revision or lifecycle precondition no longer holds."""

def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)

def event(db, task_id, kind, payload=None, step=None, attempt=None):
    return db.execute(
        "INSERT INTO events(task_id,step,attempt,kind,payload,created_at) VALUES(?,?,?,?,?,?)",
        (task_id, step, attempt, kind, encode(payload), time.time()),
    ).lastrowid

class Store:
    def __init__(self, path):
        self.path = Path(path)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA synchronous=FULL")
        return db

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.reader() as db:
            db.execute("PRAGMA journal_mode=WAL")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            original_version = version
            if version not in (0, 1, 2, 3):
                raise ValueError(f"Unsupported database version: {version}")
            if version == 0 and db.execute("SELECT 1 FROM sqlite_master WHERE name='tasks'").fetchone():
                raise ValueError("Prototype database detected. Use a new version-one runtime directory.")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY,archived INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS revisions(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,workflow_id TEXT NOT NULL,path TEXT NOT NULL,
                    digest TEXT NOT NULL,content TEXT NOT NULL,created_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS tasks(
                    id TEXT PRIMARY KEY,workflow_id TEXT NOT NULL,definition TEXT NOT NULL,input TEXT NOT NULL,
                    state TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0,epoch TEXT,
                    created_at REAL NOT NULL,updated_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS steps(
                    task_id TEXT NOT NULL REFERENCES tasks(id),name TEXT NOT NULL,state TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,successful_attempt INTEGER,
                    retries_used INTEGER NOT NULL DEFAULT 0,next_at REAL NOT NULL DEFAULT 0,
                    PRIMARY KEY(task_id,name));
                CREATE TABLE IF NOT EXISTS attempts(
                    task_id TEXT NOT NULL,step TEXT NOT NULL,number INTEGER NOT NULL,state TEXT NOT NULL,
                    started_at REAL NOT NULL,finished_at REAL,code_hash TEXT,code_dir TEXT,pid INTEGER,
                    dependencies TEXT NOT NULL,error TEXT,
                    PRIMARY KEY(task_id,step,number),
                    FOREIGN KEY(task_id,step) REFERENCES steps(task_id,name));
                CREATE TABLE IF NOT EXISTS artifacts(
                    id TEXT PRIMARY KEY,task_id TEXT NOT NULL,workflow_id TEXT NOT NULL,
                    step TEXT NOT NULL,attempt INTEGER NOT NULL,scope TEXT NOT NULL,name TEXT NOT NULL,
                    kind TEXT NOT NULL,path TEXT NOT NULL,filename TEXT NOT NULL,size INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,created_at REAL NOT NULL,published_seq INTEGER,
                    UNIQUE(task_id,step,attempt,scope,name),
                    FOREIGN KEY(task_id,step,attempt) REFERENCES attempts(task_id,step,number));
                CREATE INDEX IF NOT EXISTS artifacts_shared ON artifacts(workflow_id,scope,name,published_seq);
                CREATE TABLE IF NOT EXISTS events(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL REFERENCES tasks(id),
                    step TEXT,attempt INTEGER,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS events_task ON events(task_id,id);
                CREATE TABLE IF NOT EXISTS commands(
                    id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,task_id TEXT NOT NULL,created_at REAL NOT NULL);
            """)
            if version < 2:
                # Serialize migration across readers; never migrate a live scheduler's database.
                from .process import SchedulerLock
                with SchedulerLock(self.path.parent / "scheduler.lock"):
                    version = db.execute("PRAGMA user_version").fetchone()[0]
                    if version < 2:
                        if version == 1:
                            backup_path = self.path.with_name(self.path.name + f".v1-{time.time_ns()}.bak")
                            with sqlite3.connect(backup_path) as backup:
                                db.backup(backup)
                        db.executescript("""
                            BEGIN IMMEDIATE;
                            CREATE TABLE environments(
                                workflow_id TEXT PRIMARY KEY, state TEXT NOT NULL,
                                version INTEGER NOT NULL DEFAULT 0, current_revision TEXT, error TEXT);
                            CREATE TABLE environment_revisions(
                                id TEXT PRIMARY KEY, workflow_id TEXT, mode TEXT NOT NULL,
                                interpreter TEXT NOT NULL, generation TEXT, info TEXT NOT NULL, created_at REAL NOT NULL);
                            CREATE TABLE environment_operations(
                                id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, kind TEXT NOT NULL,
                                state TEXT NOT NULL, epoch TEXT NOT NULL, command_id TEXT UNIQUE NOT NULL,
                                fingerprint TEXT NOT NULL, request TEXT NOT NULL, directory TEXT NOT NULL,
                                created_at REAL NOT NULL, started_at REAL, finished_at REAL, error TEXT,
                                before_info TEXT, after_info TEXT, revision_id TEXT);
                            ALTER TABLE tasks ADD COLUMN environment_revision TEXT REFERENCES environment_revisions(id);
                            ALTER TABLE attempts ADD COLUMN environment_revision TEXT REFERENCES environment_revisions(id);
                            PRAGMA user_version=2;
                            COMMIT;
                        """)
            if version < 3:
                from .process import SchedulerLock
                with SchedulerLock(self.path.parent / "scheduler.lock"):
                    if db.execute("PRAGMA user_version").fetchone()[0] >= 3:
                        return
                    if original_version > 0:
                        with sqlite3.connect(self.path.with_name(self.path.name + f".v2-{time.time_ns()}.bak")) as backup:
                            db.backup(backup)
                    db.executescript("""
                        BEGIN IMMEDIATE;
                        CREATE TABLE agent_sessions(
                            id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, title TEXT NOT NULL,
                            state TEXT NOT NULL DEFAULT 'idle', version INTEGER NOT NULL DEFAULT 0,
                            new_workflow INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL, updated_at REAL NOT NULL);
                        CREATE TABLE agent_rounds(
                            id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id),
                            state TEXT NOT NULL, prompt TEXT NOT NULL, config TEXT NOT NULL,
                            created_at REAL NOT NULL, finished_at REAL, error TEXT);
                        CREATE TABLE agent_calls(
                            round_id TEXT NOT NULL REFERENCES agent_rounds(id), call_id TEXT NOT NULL,
                            name TEXT NOT NULL, arguments TEXT NOT NULL, state TEXT NOT NULL,
                            result TEXT, changes TEXT, created_at REAL NOT NULL, finished_at REAL,
                            PRIMARY KEY(round_id,call_id));
                        CREATE TABLE agent_events(
                            id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES agent_sessions(id),
                            round_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at REAL NOT NULL);
                        CREATE INDEX agent_events_session ON agent_events(session_id,id);
                        CREATE TABLE agent_commands(
                            id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
                        PRAGMA user_version=3;
                        COMMIT;
                    """)

    @contextmanager
    def reader(self, snapshot=False):
        db = self.connect()
        try:
            if snapshot:
                db.execute("BEGIN")
            yield db
        finally:
            db.close()

    @contextmanager
    def transaction(self):
        with self.reader() as db:
            try:
                db.execute("BEGIN IMMEDIATE")
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def read(self, sql, args=()):
        with self.reader() as db:
            return [dict(row) for row in db.execute(sql, args).fetchall()]
