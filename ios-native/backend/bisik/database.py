import hashlib
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .config import Settings
from .errors import APIError, unauthorized


def month_window(now: float) -> tuple[str, str]:
    date = datetime.fromtimestamp(now, timezone.utc)
    year, month = (date.year + 1, 1) if date.month == 12 else (date.year, date.month + 1)
    return date.strftime("%Y-%m"), datetime(year, month, 1, tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class Database:
    def __init__(self, settings: Settings, clock=time.time):
        self.settings, self.clock = settings, clock
        Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA secure_delete=ON;
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY, apple_subject_hash TEXT UNIQUE NOT NULL,
                refresh_ciphertext TEXT NOT NULL, deleting INTEGER NOT NULL DEFAULT 0,
                deleting_until REAL NOT NULL DEFAULT 0, credential_revoked INTEGER NOT NULL DEFAULT 0,
                subscription_id TEXT, subscription_expires REAL NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS sessions (
                hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                expires REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS signins (
                hash TEXT PRIMARY KEY, expires REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS usage (
                account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                month TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
                reserved INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(account_id, month),
                CHECK(used >= 0 AND reserved >= 0)
            );
            CREATE TABLE IF NOT EXISTS jobs (
                account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, month TEXT NOT NULL,
                seconds INTEGER NOT NULL, state TEXT NOT NULL, owner TEXT NOT NULL,
                lease_until REAL NOT NULL, text TEXT, cache_until REAL NOT NULL DEFAULT 0,
                created REAL NOT NULL, PRIMARY KEY(account_id, request_id)
            );
            CREATE INDEX IF NOT EXISTS jobs_lease ON jobs(state, lease_until);
            CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
            """)
            columns = {row["name"] for row in db.execute("PRAGMA table_info(accounts)")}
            if "deleting_until" not in columns:
                db.execute("ALTER TABLE accounts ADD COLUMN deleting_until REAL NOT NULL DEFAULT 0")
            if "credential_revoked" not in columns:
                db.execute("ALTER TABLE accounts ADD COLUMN credential_revoked INTEGER NOT NULL DEFAULT 0")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.settings.database_path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA secure_delete=ON")
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def transaction(self):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                yield db
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise

    def maintain(self):
        now = self.clock()
        with self.transaction() as db:
            for row in db.execute("SELECT * FROM jobs WHERE state='pending' AND lease_until<=?", (now,)).fetchall():
                db.execute("UPDATE usage SET reserved=reserved-? WHERE account_id=? AND month=?",
                           (row["seconds"], row["account_id"], row["month"]))
                db.execute("UPDATE jobs SET state='failed', text=NULL WHERE account_id=? AND request_id=?",
                           (row["account_id"], row["request_id"]))
            db.execute("UPDATE jobs SET text=NULL WHERE cache_until<=? AND text IS NOT NULL", (now,))
            db.execute("DELETE FROM sessions WHERE expires<=?", (now,))
            db.execute("DELETE FROM signins WHERE expires<=?", (now,))
            db.execute("UPDATE accounts SET deleting=0,deleting_until=0 WHERE deleting=1 AND deleting_until<=?", (now,))
            # Retain content-free idempotency tombstones to avoid billing a reused request ID.
            # Monthly usage is separate; keeping tombstones until account deletion is cheap.
        with self.connection() as db:
            db.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    def find_account(self, subject: str):
        with self.connection() as db:
            row = db.execute("SELECT * FROM accounts WHERE apple_subject_hash=?", (digest(subject),)).fetchone()
            return dict(row) if row else None

    def sign_in(self, subject: str, identity_token: str, expires: float, refresh_ciphertext: str | None):
        token = secrets.token_urlsafe(32)
        with self.transaction() as db:
            if db.execute("SELECT 1 FROM signins WHERE hash=?", (digest(identity_token),)).fetchone():
                raise unauthorized()
            row = db.execute("SELECT * FROM accounts WHERE apple_subject_hash=?", (digest(subject),)).fetchone()
            if row and row["deleting"]:
                raise APIError(409, "account_deleting", "Penghapusan akun sedang diproses.")
            if not row:
                if not refresh_ciphertext:
                    raise APIError(401, "authorization_required", "Masuk kembali agar akun dapat dikelola dengan aman.")
                account = str(uuid4())
                db.execute("INSERT INTO accounts(id,apple_subject_hash,refresh_ciphertext) VALUES(?,?,?)",
                           (account, digest(subject), refresh_ciphertext))
            else:
                account = row["id"]
                if refresh_ciphertext:
                    db.execute("UPDATE accounts SET refresh_ciphertext=?,credential_revoked=0 WHERE id=?", (refresh_ciphertext, account))
            db.execute("INSERT INTO signins VALUES(?,?)", (digest(identity_token), expires))
            db.execute("INSERT INTO sessions VALUES(?,?,?)", (digest(token), account, self.clock() + self.settings.session_seconds))
        return token, account

    def authenticate(self, token: str, allow_revoked=False):
        if len(token) < 32 or len(token) > 256:
            raise unauthorized()
        with self.connection() as db:
            row = db.execute("""SELECT a.* FROM accounts a JOIN sessions s ON s.account_id=a.id
                                WHERE s.hash=? AND s.expires>? AND a.deleting=0""", (digest(token), self.clock())).fetchone()
        if row is None:
            raise unauthorized()
        if row["credential_revoked"] and not allow_revoked:
            raise unauthorized()
        return dict(row)

    def logout(self, token: str):
        with self.transaction() as db:
            db.execute("DELETE FROM sessions WHERE hash=?", (digest(token),))

    def mark_deleting(self, account: str):
        with self.transaction() as db:
            if db.execute("UPDATE accounts SET deleting=1,deleting_until=? WHERE id=? AND deleting=0",
                          (self.clock() + 60, account)).rowcount != 1:
                raise unauthorized()

    def cancel_deleting(self, account: str):
        with self.transaction() as db:
            db.execute("UPDATE accounts SET deleting=0,deleting_until=0 WHERE id=?", (account,))

    def credential_revoked(self, account: str):
        with self.transaction() as db:
            db.execute("UPDATE accounts SET credential_revoked=1,refresh_ciphertext='' WHERE id=?", (account,))

    def delete_account(self, account: str):
        with self.transaction() as db:
            db.execute("DELETE FROM accounts WHERE id=?", (account,))
        self.maintain()

    def subscription(self, account: str, original_id: str | None, expires: float):
        with self.transaction() as db:
            if db.execute("""UPDATE accounts SET subscription_id=?, subscription_expires=?
                             WHERE id=? AND deleting=0""", (original_id, expires, account)).rowcount != 1:
                raise unauthorized()

    def _quota(self, db, account: str, now: float):
        owner = db.execute("SELECT * FROM accounts WHERE id=? AND deleting=0", (account,)).fetchone()
        if not owner:
            raise unauthorized()
        month, reset = month_window(now)
        row = db.execute("SELECT used,reserved FROM usage WHERE account_id=? AND month=?", (account, month)).fetchone()
        pro = owner["subscription_expires"] > now
        return {"usedSeconds": row["used"] + row["reserved"] if row else 0,
                "limitSeconds": self.settings.pro_seconds if pro else self.settings.free_seconds,
                "resetAt": reset, "plan": "pro" if pro else "free"}

    def quota(self, account: str):
        with self.connection() as db:
            return self._quota(db, account, self.clock())

    def reserve(self, account: str, request_id: str, fingerprint: str, seconds: int):
        self.maintain()
        now, owner = self.clock(), str(uuid4())
        month, _ = month_window(now)
        with self.transaction() as db:
            quota = self._quota(db, account, now)
            existing = db.execute("SELECT * FROM jobs WHERE account_id=? AND request_id=?", (account, request_id)).fetchone()
            if existing:
                if existing["fingerprint"] != fingerprint:
                    raise APIError(409, "request_conflict", "ID rekaman sudah digunakan untuk rekaman lain.")
                if existing["state"] == "done":
                    if existing["text"] is None or existing["cache_until"] <= now:
                        raise APIError(409, "result_expired", "Hasil sementara telah dihapus. Rekaman ini tidak ditagih lagi.")
                    return {"text": existing["text"], "quota": quota}
                if existing["state"] == "pending":
                    raise APIError(409, "request_in_progress", "Rekaman ini masih diproses. Coba lagi sebentar.")
            if quota["usedSeconds"] + seconds > quota["limitSeconds"]:
                raise APIError(402, "quota_exceeded", "Kuota transkripsi bulan ini sudah habis.")
            db.execute("INSERT OR IGNORE INTO usage(account_id,month) VALUES(?,?)", (account, month))
            db.execute("UPDATE usage SET reserved=reserved+? WHERE account_id=? AND month=?", (seconds, account, month))
            db.execute("""INSERT INTO jobs VALUES(?,?,?,?,?,'pending',?,?,NULL,0,?)
                          ON CONFLICT(account_id,request_id) DO UPDATE SET month=excluded.month,
                          seconds=excluded.seconds,state='pending',owner=excluded.owner,
                          lease_until=excluded.lease_until,text=NULL,cache_until=0""",
                       (account, request_id, fingerprint, month, seconds, owner, now + self.settings.lease_seconds, now))
        return owner

    def finish(self, account: str, request_id: str, owner: str, text: str):
        now = self.clock()
        with self.transaction() as db:
            row = db.execute("SELECT * FROM jobs WHERE account_id=? AND request_id=? AND owner=? AND state='pending'",
                             (account, request_id, owner)).fetchone()
            if row is None:
                raise APIError(409, "request_expired", "Pemrosesan rekaman kedaluwarsa. Coba lagi.")
            self._quota(db, account, now)  # Do not recreate data during account deletion.
            db.execute("UPDATE usage SET reserved=reserved-?,used=used+? WHERE account_id=? AND month=?",
                       (row["seconds"], row["seconds"], account, row["month"]))
            db.execute("UPDATE jobs SET state='done',text=?,cache_until=? WHERE account_id=? AND request_id=?",
                       (text, now + self.settings.cache_seconds, account, request_id))
            return {"text": text, "quota": self._quota(db, account, now)}

    def compensate(self, account: str, request_id: str, owner: str):
        with self.transaction() as db:
            row = db.execute("SELECT * FROM jobs WHERE account_id=? AND request_id=? AND owner=? AND state='pending'",
                             (account, request_id, owner)).fetchone()
            if row:
                db.execute("UPDATE usage SET reserved=reserved-? WHERE account_id=? AND month=?", (row["seconds"], account, row["month"]))
                db.execute("UPDATE jobs SET state='failed',text=NULL WHERE account_id=? AND request_id=?", (account, request_id))
