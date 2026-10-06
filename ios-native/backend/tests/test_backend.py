import asyncio
import hashlib
import io
import json
import shutil
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import httpx
import jwt
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from bisik.apple import AppleIdentity, AppleSubscriptions, Entitlement, Identity
from bisik.config import Settings
from bisik.database import Database, digest
from bisik.errors import APIError, unavailable
from bisik.main import create_app
from bisik.provider import TranscriptionProvider, apply_dictionary, measured_seconds


def wav_audio(seconds=1):
    output = io.BytesIO()
    with wave.open(output, "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(16000)
        file.writeframes(b"\x00\x00" * int(seconds * 16000))
    return output.getvalue()


@pytest.fixture
def settings(tmp_path):
    return Settings(database_path=str(tmp_path / "test.sqlite3"), environment="test",
                    bundle_id="com.bisik.test", free_seconds=10, cache_seconds=5)


@pytest.fixture
def db(settings):
    return Database(settings)


def user(db, subject="apple-user"):
    return db.sign_in(subject, "identity-token-" + str(uuid4()), time.time() + 600, "encrypted-refresh")


def test_sessions_are_opaque_hashed_revocable_and_account_bound(db):
    token, account = user(db)
    token2, _ = user(db, "other-user")
    with db.connection() as sql:
        assert sql.execute("SELECT hash FROM sessions WHERE account_id=?", (account,)).fetchone()[0] == digest(token)
        assert sql.execute("SELECT apple_subject_hash FROM accounts WHERE id=?", (account,)).fetchone()[0] != "apple-user"
    assert db.authenticate(token)["id"] == account
    db.logout(token)
    with pytest.raises(APIError) as error:
        db.authenticate(token)
    assert error.value.status == 401
    assert db.authenticate(token2)


def test_identity_token_replay_is_rejected(db):
    db.sign_in("user", "same-token", time.time() + 60, "encrypted")
    with pytest.raises(APIError) as error:
        db.sign_in("user", "same-token", time.time() + 60, "encrypted")
    assert error.value.status == 401


def test_atomic_quota_two_concurrent_requests_cannot_overspend(db):
    _, account = user(db)
    def reserve(number):
        try:
            return db.reserve(account, str(uuid4()), str(number), 7)
        except APIError as error:
            return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(reserve, [1, 2]))
    assert results.count("quota_exceeded") == 1
    assert db.quota(account)["usedSeconds"] == 7


def test_duplicate_request_single_charge_cached_result_and_payload_conflict(db):
    _, account = user(db)
    request_id = str(uuid4())
    owner = db.reserve(account, request_id, "audio-fingerprint", 3)
    with pytest.raises(APIError) as pending:
        db.reserve(account, request_id, "audio-fingerprint", 3)
    assert pending.value.code == "request_in_progress"
    result = db.finish(account, request_id, owner, "Halo dunia")
    assert result["quota"]["usedSeconds"] == 3
    assert db.reserve(account, request_id, "audio-fingerprint", 3) == result
    with pytest.raises(APIError) as changed:
        db.reserve(account, request_id, "different-audio", 3)
    assert changed.value.code == "request_conflict"


def test_failed_provider_compensation_and_retry_no_double_charge(db):
    _, account = user(db)
    request_id = str(uuid4())
    owner = db.reserve(account, request_id, "fingerprint", 8)
    db.compensate(account, request_id, owner)
    db.compensate(account, request_id, owner)
    assert db.quota(account)["usedSeconds"] == 0
    new_owner = db.reserve(account, request_id, "fingerprint", 8)
    assert new_owner != owner
    db.compensate(account, request_id, owner)
    assert db.quota(account)["usedSeconds"] == 8
    db.finish(account, request_id, new_owner, "Hasil")
    assert db.quota(account)["usedSeconds"] == 8


def test_expired_cache_erases_transcript_keeps_no_recharge_tombstone(settings):
    now = [time.time()]
    db = Database(settings, clock=lambda: now[0])
    _, account = user(db)
    request_id = str(uuid4())
    owner = db.reserve(account, request_id, "fp", 2)
    db.finish(account, request_id, owner, "PRIVATE TEXT")
    now[0] += 6
    db.maintain()
    with db.connection() as sql:
        assert sql.execute("SELECT text FROM jobs").fetchone()[0] is None
    with pytest.raises(APIError) as error:
        db.reserve(account, request_id, "fp", 2)
    assert error.value.code == "result_expired"
    assert db.quota(account)["usedSeconds"] == 2


def test_crash_lease_compensates_and_old_owner_cannot_finish(settings):
    now = [time.time()]
    db = Database(settings, clock=lambda: now[0])
    _, account = user(db)
    request_id = str(uuid4())
    owner = db.reserve(account, request_id, "fp", 8)
    now[0] += settings.lease_seconds + 1
    db.maintain()
    assert db.quota(account)["usedSeconds"] == 0
    with pytest.raises(APIError):
        db.finish(account, request_id, owner, "Too late")


def test_month_reset_is_utc_calendar_month_and_annual_uses_monthly_quota(settings):
    now = [datetime(2026, 12, 31, 23, 59, 59, tzinfo=timezone.utc).timestamp()]
    db = Database(settings, clock=lambda: now[0])
    _, account = user(db)
    db.subscription(account, "annual-original", now[0] + 365 * 86400)
    owner = db.reserve(account, "request", "fp", 12)
    assert db.quota(account)["limitSeconds"] == 18000
    now[0] += 2
    db.finish(account, "request", owner, "cross month")
    quota = db.quota(account)
    assert quota["usedSeconds"] == 0  # Charged to reservation month, never to next month.
    assert quota["resetAt"] == "2027-02-01T00:00:00Z"


def test_delete_cascades_accounts_sessions_usage_jobs_and_blocks_inflight(db):
    token, account = user(db)
    owner = db.reserve(account, "id", "fp", 4)
    db.mark_deleting(account)
    with pytest.raises(APIError):
        db.authenticate(token)
    with pytest.raises(APIError):
        db.finish(account, "id", owner, "Do not store")
    db.delete_account(account)
    db.compensate(account, "id", owner)
    with db.connection() as sql:
        for table in ("accounts", "sessions", "usage", "jobs"):
            assert sql.execute("SELECT count(*) FROM " + table).fetchone()[0] == 0


def test_deletion_crash_recovers_lease_and_does_not_restore_revoked_access(settings):
    now = [time.time()]
    db = Database(settings, clock=lambda: now[0])
    token, account = user(db)
    db.mark_deleting(account)
    now[0] += 61
    db.maintain()
    assert db.authenticate(token)["id"] == account
    db.mark_deleting(account)
    db.credential_revoked(account)
    now[0] += 61
    db.maintain()
    with pytest.raises(APIError):
        db.authenticate(token)
    assert db.authenticate(token, allow_revoked=True)["refresh_ciphertext"] == ""
    db.delete_account(account)


def test_account_scoped_request_id(db):
    _, a = user(db, "a")
    _, b = user(db, "b")
    owner = db.reserve(a, "same-id", "fp", 2)
    db.finish(a, "same-id", owner, "A private text")
    owner_b = db.reserve(b, "same-id", "fp", 2)
    assert isinstance(owner_b, str)
    assert db.finish(b, "same-id", owner_b, "B private text")["text"] == "B private text"


def test_dictionary_whole_words_longest_match_no_cascade():
    entries = [{"source": "koda", "replacement": "Codex"}, {"source": "codex", "replacement": "bad"},
               {"source": "open whisper", "replacement": "OpenWhispr"}]
    assert apply_dictionary("Koda, kodaku, open whisper.", entries) == "Codex, kodaku, OpenWhispr."


def test_real_ffprobe_measures_audio_and_temp_file_deleted(settings, tmp_path):
    if not shutil.which(settings.ffprobe_path):
        pytest.skip("ffprobe is required for integration test")
    configured = replace(settings, temp_directory=str(tmp_path))
    assert measured_seconds(wav_audio(1.25), ".wav", configured) == 2
    assert not list(tmp_path.glob("bisik-*"))
    with pytest.raises(APIError) as bad:
        measured_seconds(b"not an audio", ".wav", configured)
    assert bad.value.code == "invalid_audio"
    assert not list(tmp_path.glob("bisik-*"))


class MockIdentity:
    def __init__(self):
        self.revoked = []
        self.revoke_error = False
    async def verify(self, token, nonce):
        return Identity("test-subject", time.time() + 600)
    async def exchange(self, code, claims):
        assert code == "authorization-code"
        return "encrypted-refresh"
    async def revoke(self, ciphertext):
        if self.revoke_error:
            raise unavailable()
        self.revoked.append(ciphertext)


class MockSubscriptions:
    def __init__(self):
        self.active = False
        self.fail = False
    async def verify(self, signed, account):
        if self.fail:
            raise unavailable()
        return Entitlement("original", time.time() + 3600) if self.active else None
    async def refresh(self, original, account):
        return await self.verify("", account)


class MockProvider:
    def __init__(self):
        self.calls = 0
        self.fail = False
        self.wait = None
    async def bounded_transcribe(self, audio, filename, language, dictionary):
        self.calls += 1
        if self.wait:
            await self.wait.wait()
        if self.fail:
            raise APIError(502, "transcription_failed", "Pemrosesan gagal.")
        return apply_dictionary("Halo koda", dictionary)


@pytest.fixture
def context(settings, db):
    identity, subscriptions, provider = MockIdentity(), MockSubscriptions(), MockProvider()
    app = create_app(settings, database=db, identity=identity, subscriptions=subscriptions,
                     provider=provider, duration_probe=lambda *args: 3)
    token, account = user(db, "test-subject")
    return SimpleNamespace(app=app, db=db, identity=identity, subscriptions=subscriptions,
                           provider=provider, token=token, account=account)


def client(context):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=context.app), base_url="http://test",
                             headers={"Authorization": "Bearer " + context.token})


async def upload(http, request_id=None, audio=b"test-audio", dictionary=None):
    return await http.post("/v1/transcriptions", files={"file": ("voice.wav", audio, "audio/wav")},
                           data={"requestID": request_id or str(uuid4()), "language": "id-ID",
                                 "dictionary": json.dumps(dictionary or [])})


@pytest.mark.asyncio
async def test_http_transcript_idempotent_auto_dictionary_and_quota(context):
    request_id = str(uuid4())
    dictionary = [{"source": "koda", "replacement": "Codex"}]
    async with client(context) as http:
        a = await upload(http, request_id, dictionary=dictionary)
        b = await upload(http, request_id, dictionary=dictionary)
        changed = await upload(http, request_id, audio=b"different", dictionary=dictionary)
    assert a.status_code == b.status_code == 200
    assert a.json() == b.json()
    assert a.json()["text"] == "Halo Codex"
    assert changed.status_code == 409
    assert context.provider.calls == 1


@pytest.mark.asyncio
async def test_http_failure_compensates_and_missing_client_duration_not_trusted(context):
    context.provider.fail = True
    request_id = str(uuid4())
    async with client(context) as http:
        failed = await upload(http, request_id)
        assert failed.status_code == 502
        assert (await http.get("/v1/quota")).json()["usedSeconds"] == 0
        context.provider.fail = False
        assert (await upload(http, request_id)).status_code == 200
        assert (await http.get("/v1/quota")).json()["usedSeconds"] == 3
        # Arbitrary client fields are rejected, including a fake claimed duration.
        invalid = await http.post("/v1/transcriptions", files={"file": ("voice.wav", b"test")},
                                  data={"requestID": str(uuid4()), "duration": "0"})
        assert invalid.status_code == 400


@pytest.mark.asyncio
async def test_http_concurrent_duplicate_only_one_provider_call(context):
    context.provider.wait = asyncio.Event()
    request_id = str(uuid4())
    async with client(context) as http:
        first = asyncio.create_task(upload(http, request_id))
        for _ in range(100):
            if context.provider.calls:
                break
            await asyncio.sleep(0.01)
        duplicate = await upload(http, request_id)
        assert duplicate.status_code == 409
        assert duplicate.json()["code"] == "request_in_progress"
        context.provider.wait.set()
        assert (await first).status_code == 200
    assert context.provider.calls == 1


@pytest.mark.asyncio
async def test_account_delete_revokes_apple_and_failure_can_retry(context):
    async with client(context) as http:
        context.identity.revoke_error = True
        assert (await http.delete("/v1/account")).status_code == 503
        assert (await http.get("/v1/quota")).status_code == 200
        context.identity.revoke_error = False
        assert (await http.delete("/v1/account")).status_code == 200
        assert (await http.get("/v1/quota")).status_code == 401
    assert context.identity.revoked == ["encrypted-refresh"]


@pytest.mark.asyncio
async def test_auth_new_account_requires_code_and_exchange_before_login(settings):
    identity = MockIdentity()
    app = create_app(settings, identity=identity, subscriptions=MockSubscriptions(), provider=MockProvider())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
        payload = {"identityToken": "test-identity-token", "nonce": "a" * 32}
        assert (await http.post("/v1/auth/apple", json=payload)).json()["code"] == "authorization_required"
        payload["authorizationCode"] = "authorization-code"
        response = await http.post("/v1/auth/apple", json=payload)
        assert response.status_code == 200
        assert UUID_valid(response.json()["accountToken"])
        assert (await http.post("/v1/auth/apple", json=payload)).status_code == 401


def UUID_valid(value):
    from uuid import UUID
    return bool(UUID(value))


@pytest.mark.asyncio
async def test_subscription_online_refresh_revocation_and_outage_fail_closed(context):
    async with client(context) as http:
        context.subscriptions.active = True
        verified = await http.post("/v1/subscriptions/verify", json={"signedTransaction": "signed-test-transaction"})
        assert verified.json()["quota"]["plan"] == "pro"
        context.subscriptions.active = False
        assert (await http.get("/v1/quota")).json()["plan"] == "free"
        context.subscriptions.fail = True
        assert (await upload(http)).status_code == 503
    assert context.provider.calls == 0


@pytest.mark.asyncio
async def test_chunked_body_limit_before_parser_and_auth(context, settings):
    app = create_app(replace(settings, max_audio_bytes=100), database=context.db,
                     identity=context.identity, subscriptions=context.subscriptions, provider=context.provider)
    async def chunks():
        yield b"a" * (600 * 1024)
        yield b"b" * (600 * 1024)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
        response = await http.post("/v1/transcriptions", content=chunks(), headers={"Content-Type": "multipart/form-data; boundary=x"})
        assert response.status_code == 413
    assert context.provider.calls == 0


@pytest.mark.asyncio
async def test_validation_does_not_echo_tokens(context):
    async with client(context) as http:
        response = await http.post("/v1/auth/apple", json={"identityToken": "SECRET", "nonce": "bad"})
        assert response.status_code == 422
        assert "SECRET" not in response.text


@pytest.mark.asyncio
async def test_missing_production_configuration_never_fake_auth_stt_or_receipt(settings):
    empty = replace(settings, environment="production", bundle_id="")
    assert not empty.provider_ready() and not empty.apple_ready() and not empty.signin_ready()
    with pytest.raises(APIError) as auth:
        await AppleIdentity(empty).verify("token", "nonce")
    assert auth.value.status == 503
    with pytest.raises(APIError) as receipt:
        await AppleSubscriptions(empty).verify("fake-receipt", str(uuid4()))
    assert receipt.value.status == 503
    with pytest.raises(APIError) as stt:
        await TranscriptionProvider(empty).bounded_transcribe(b"audio", "audio.wav", "id-ID", [])
    assert stt.value.status == 503
    insecure = replace(empty, stt_base_url="http://provider.example/v1", stt_api_key="key", stt_model="model")
    assert not insecure.provider_ready()


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["issuer", "audience", "expired", "nonce", "missing_nonce", "old", "algorithm"])
async def test_real_jwt_signature_claims_and_raw_nonce_validation(settings, monkeypatch, change):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    identity = AppleIdentity(settings)
    monkeypatch.setattr(identity.jwks, "get_signing_key_from_jwt", lambda token: SimpleNamespace(key=key.public_key()))
    nonce = "secure-random-nonce-for-testing-32chars"
    now = time.time()
    claims = {"iss": "https://appleid.apple.com", "aud": settings.bundle_id, "exp": now + 600,
              "iat": now, "sub": "subject", "nonce": hashlib.sha256(nonce.encode()).hexdigest()}
    good = jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test"})
    assert (await identity.verify(good, nonce)).subject == "subject"
    if change == "issuer":
        claims["iss"] = "https://attacker.invalid"
    elif change == "audience":
        claims["aud"] = "other.app"
    elif change == "expired":
        claims["exp"] = now - 60
    elif change == "nonce":
        claims["nonce"] = nonce  # The raw nonce is never the JWT nonce claim.
    elif change == "missing_nonce":
        del claims["nonce"]
    elif change == "old":
        claims["iat"] = now - 601
    bad = jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test"}) if change != "algorithm" else jwt.encode(claims, None, algorithm="none")
    with pytest.raises(APIError) as error:
        await identity.verify(bad, nonce)
    assert error.value.code == "unauthorized"


@pytest.mark.asyncio
async def test_oauth_exchange_encrypts_refresh_and_revoke_calls_apple(settings, tmp_path, monkeypatch):
    signing = ec.generate_private_key(ec.SECP256R1())
    key_path = tmp_path / "sign-in-key.p8"
    key_path.write_bytes(signing.private_bytes(serialization.Encoding.PEM,
                                             serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    encryption = Fernet.generate_key().decode()
    configured = replace(settings, signin_team_id="TEAMID", signin_key_id="KEYID",
                         signin_private_key_path=str(key_path), refresh_encryption_key=encryption)
    identity = AppleIdentity(configured)
    monkeypatch.setattr(identity, "_decode", lambda token: {"sub": "subject"})
    calls = []
    def handler(request):
        from urllib.parse import parse_qs
        data = parse_qs(request.content.decode())
        secret = jwt.decode(data["client_secret"][0], signing.public_key(), algorithms=["ES256"],
                            audience="https://appleid.apple.com", issuer="TEAMID")
        assert secret["sub"] == configured.bundle_id
        assert secret["exp"] - secret["iat"] == 300
        calls.append(request.url.path)
        if request.url.path == "/auth/token":
            assert data["code"] == ["one-time-code"]
            return httpx.Response(200, json={"id_token": "verified-apple-token", "refresh_token": "private-refresh-token"})
        assert request.url.path == "/auth/revoke"
        assert data["token"] == ["private-refresh-token"]
        return httpx.Response(200)
    original_client = httpx.AsyncClient
    monkeypatch.setattr("bisik.apple.httpx.AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    ciphertext = await identity.exchange("one-time-code", Identity("subject", time.time() + 600))
    assert "private-refresh-token" not in ciphertext
    assert Fernet(encryption.encode()).decrypt(ciphertext.encode()) == b"private-refresh-token"
    await identity.revoke(ciphertext)
    assert calls == ["/auth/token", "/auth/revoke"]
    with pytest.raises(APIError):
        await identity.exchange("one-time-code", Identity("other-subject", time.time() + 600))


def signed_fixture(settings, account, *, status=1, expires=None, revoked=None, upgraded=False, mismatch=False):
    from appstoreserverlibrary.models.Environment import Environment
    from appstoreserverlibrary.models.Status import Status
    from appstoreserverlibrary.models.Type import Type
    now = int(time.time() * 1000)
    common = dict(bundleId=settings.bundle_id, productId=settings.product_ids[0], type=Type.AUTO_RENEWABLE_SUBSCRIPTION,
                  appAccountToken=str(uuid4()) if mismatch else account, originalTransactionId="original-123",
                  purchaseDate=now - 10000, revocationDate=revoked, isUpgraded=upgraded)
    old = SimpleNamespace(**common, signedDate=now - 10000, expiresDate=now - 1000)
    latest = SimpleNamespace(**common, signedDate=now, expiresDate=expires if expires is not None else now + 3600000)
    class Verifier:
        def __init__(self):
            self.calls = []
        def verify_and_decode_signed_transaction(self, signed):
            self.calls.append(signed)
            if signed == "client-old-signed":
                return old
            if signed == "server-latest-signed":
                return latest
            raise ValueError("Bad signature SECRET")
    class Client:
        def __init__(self):
            self.closed = False
            self.calls = []
        async def get_all_subscription_statuses(self, original):
            self.calls.append(original)
            return SimpleNamespace(bundleId=settings.bundle_id, environment=Environment.SANDBOX, appAppleId=None,
                                   data=[SimpleNamespace(lastTransactions=[SimpleNamespace(originalTransactionId="original-123",
                                         signedTransactionInfo="server-latest-signed", status=Status(status))])])
        async def async_close(self):
            self.closed = True
    verifier, api = Verifier(), Client()
    subscriptions = AppleSubscriptions(replace(settings, apple_environment="Sandbox"))
    subscriptions._components = lambda: (verifier, api)
    return subscriptions, verifier, api


@pytest.mark.asyncio
async def test_official_verifier_adapter_old_client_receipt_refreshes_latest_online(settings):
    account = str(uuid4())
    subscriptions, verifier, api = signed_fixture(settings, account)
    result = await subscriptions.verify("client-old-signed", account)
    assert result.original_id == "original-123" and result.expires > time.time()
    assert api.calls == ["original-123"]
    assert verifier.calls == ["client-old-signed", "server-latest-signed"]
    assert api.closed


@pytest.mark.asyncio
@pytest.mark.parametrize("kwargs", [{"status": 2}, {"status": 3}, {"status": 4}, {"status": 5},
                                        {"expires": 1}, {"revoked": 1}, {"upgraded": True}])
async def test_revoked_expired_billing_retry_grace_or_upgraded_never_grants(settings, kwargs):
    account = str(uuid4())
    subscriptions, _, api = signed_fixture(settings, account, **kwargs)
    assert await subscriptions.verify("client-old-signed", account) is None
    assert api.closed


@pytest.mark.asyncio
async def test_receipt_account_binding_and_signature_error_are_sanitized(settings):
    account = str(uuid4())
    subscriptions, _, api = signed_fixture(settings, account, mismatch=True)
    with pytest.raises(APIError) as mismatch:
        await subscriptions.verify("client-old-signed", account)
    assert mismatch.value.code == "transaction_mismatch"
    assert not api.calls
    subscriptions, _, api = signed_fixture(settings, account)
    with pytest.raises(APIError) as invalid:
        await subscriptions.verify("forged-transaction", account)
    assert invalid.value.code == "invalid_transaction" and "SECRET" not in invalid.value.message
    assert api.closed


@pytest.mark.asyncio
async def test_provider_stt_cleanup_dictionary_and_secret_safe_errors(settings, monkeypatch):
    configured = replace(settings, stt_base_url="https://speech.test/v1", stt_api_key="PRIVATE_STT_KEY", stt_model="speech-model",
                         cleanup_base_url="https://cleanup.test/v1", cleanup_api_key="PRIVATE_AI_KEY", cleanup_model="cleanup-model")
    calls = []
    fail = [False]
    def handler(request):
        calls.append(request.url.path)
        if fail[0]:
            return httpx.Response(400, json={"error": "upstream-private-secret"})
        if request.url.path == "/v1/audio/transcriptions":
            assert request.headers["authorization"] == "Bearer PRIVATE_STT_KEY"
            assert b"speech-model" in request.content and b"Codex" in request.content
            return httpx.Response(200, json={"text": "halo koda"})
        assert request.headers["authorization"] == "Bearer PRIVATE_AI_KEY"
        assert json.loads(request.content)["model"] == "cleanup-model"
        return httpx.Response(200, json={"choices": [{"message": {"content": "Halo koda."}}]})
    original_client = httpx.AsyncClient
    monkeypatch.setattr("bisik.provider.httpx.AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    provider = TranscriptionProvider(configured)
    text = await provider.bounded_transcribe(b"audio", "voice.wav", "id-ID", [{"source": "koda", "replacement": "Codex"}])
    assert text == "Halo Codex."
    assert calls == ["/v1/audio/transcriptions", "/v1/chat/completions"]
    fail[0] = True
    with pytest.raises(APIError) as error:
        await provider.bounded_transcribe(b"audio", "voice.wav", "id-ID", [])
    assert error.value.code == "transcription_failed"
    assert "secret" not in error.value.message and "PRIVATE" not in error.value.message
