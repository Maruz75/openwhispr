import asyncio
import hashlib
import json
import re
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from uuid import UUID

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from .apple import AppleIdentity, AppleSubscriptions
from .config import Settings
from .database import Database
from .errors import APIError, unauthorized
from .provider import TranscriptionProvider, measured_seconds


class BodyLimit:
    """Bound the body before multipart parsing, including chunked requests.

    A declared Content-Length alone is not a security boundary. Small bounded
    uploads are buffered in RAM; multipart files also stay in RAM until ffprobe.
    A reverse proxy should impose matching body/rate/concurrent connection limits.
    """

    def __init__(self, app, audio_limit: int):
        self.app, self.audio_limit = app, audio_limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = self.audio_limit + 1024 * 1024 if scope["path"] == "/v1/transcriptions" else 64 * 1024
        headers = dict(scope.get("headers", []))
        try:
            length = int(headers.get(b"content-length", b"0"))
            if length < 0:
                raise ValueError()
        except ValueError:
            return await JSONResponse({"code": "invalid_request", "message": "Permintaan tidak valid."}, 400)(scope, receive, send)
        if length > limit:
            return await self._too_large(scope, receive, send)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > limit:
                return await self._too_large(scope, receive, send)
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body, delivered = b"".join(chunks), False
        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()
        return await self.app(scope, bounded_receive, send)

    async def _too_large(self, scope, receive, send):
        return await JSONResponse({"code": "upload_too_large", "message": "Rekaman terlalu besar. Buat rekaman lebih singkat."}, 413)(scope, receive, send)


class AppleLogin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    identityToken: str = Field(min_length=16, max_length=12000)
    nonce: str = Field(min_length=16, max_length=256)
    authorizationCode: str | None = Field(default=None, min_length=1, max_length=4000)


class SubscriptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    signedTransaction: str = Field(min_length=16, max_length=60000)


class DictionaryEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(min_length=1, max_length=80)
    replacement: str = Field(min_length=1, max_length=80)


def create_app(settings: Settings | None = None, *, database=None, identity=None,
               subscriptions=None, provider=None, duration_probe=measured_seconds):
    settings = settings or Settings.from_env()
    database = database or Database(settings)
    identity = identity or AppleIdentity(settings)
    subscriptions = subscriptions or AppleSubscriptions(settings)
    provider = provider or TranscriptionProvider(settings)

    @asynccontextmanager
    async def lifespan(app):
        async def maintenance():
            while True:
                await asyncio.to_thread(database.maintain)
                await asyncio.sleep(30)
        database.maintain()
        task = asyncio.create_task(maintenance())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="Bisik API", version="1.0.0", lifespan=lifespan,
                  docs_url="/docs" if settings.environment == "development" else None,
                  redoc_url=None, openapi_url="/openapi.json" if settings.environment == "development" else None)
    app.add_middleware(BodyLimit, audio_limit=settings.max_audio_bytes)
    app.state.database = database

    @app.exception_handler(APIError)
    async def safe_error(request, error):
        return JSONResponse({"code": error.code, "message": error.message}, error.status)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        # Validation details can include the original JWT or malformed transcript; don't reflect them.
        return JSONResponse({"code": "invalid_request", "message": "Permintaan tidak valid."}, 422)

    @app.exception_handler(Exception)
    async def internal_error(request, error):
        return JSONResponse({"code": "service_unavailable", "message": "Layanan belum siap. Coba lagi nanti."}, 503)

    async def session(request: Request):
        authorization = request.headers.get("authorization", "")
        if not authorization.startswith("Bearer "):
            raise unauthorized()
        allow_revoked = request.url.path == "/v1/account" and request.method == "DELETE"
        return await asyncio.to_thread(database.authenticate, authorization[7:], allow_revoked)

    async def refresh_entitlement(account):
        if account["subscription_id"]:
            result = await subscriptions.refresh(account["subscription_id"], account["id"])
            await asyncio.to_thread(database.subscription, account["id"], account["subscription_id"], result.expires if result else 0)

    @app.get("/health")
    async def health():
        return {"status": "ok", "configured": bool(settings.provider_ready() and settings.signin_ready() and settings.apple_ready())}

    @app.post("/v1/auth/apple")
    async def apple_login(payload: AppleLogin):
        claims = await identity.verify(payload.identityToken, payload.nonce)
        previous = await asyncio.to_thread(database.find_account, claims.subject)
        if previous and previous["deleting"]:
            raise APIError(409, "account_deleting", "Penghapusan akun sedang diproses.")
        ciphertext = None
        if payload.authorizationCode:
            ciphertext = await identity.exchange(payload.authorizationCode, claims)
        elif not previous:
            raise APIError(401, "authorization_required", "Masuk kembali agar akun dapat dikelola dengan aman.")
        if previous:
            await refresh_entitlement(previous)
        token, account_id = await asyncio.to_thread(database.sign_in, claims.subject, payload.identityToken, claims.expires, ciphertext)
        return {"accessToken": token, "accountToken": account_id, "quota": await asyncio.to_thread(database.quota, account_id)}

    @app.post("/v1/auth/logout")
    async def logout(request: Request, account=Depends(session)):
        await asyncio.to_thread(database.logout, request.headers["authorization"][7:])
        return {"ok": True}

    @app.delete("/v1/account")
    async def delete_account(account=Depends(session)):
        await asyncio.to_thread(database.mark_deleting, account["id"])
        try:
            if not account["credential_revoked"]:
                await identity.revoke(account["refresh_ciphertext"])
                await asyncio.to_thread(database.credential_revoked, account["id"])
            await asyncio.to_thread(database.delete_account, account["id"])
        except BaseException:
            await asyncio.shield(asyncio.to_thread(database.cancel_deleting, account["id"]))
            raise
        return {"ok": True}

    @app.get("/v1/quota")
    async def quota(account=Depends(session)):
        await refresh_entitlement(account)
        return await asyncio.to_thread(database.quota, account["id"])

    @app.post("/v1/subscriptions/verify")
    async def verify_subscription(payload: SubscriptionRequest, account=Depends(session)):
        result = await subscriptions.verify(payload.signedTransaction, account["id"])
        if result is None:
            # A verified matching expired transaction can be finished by StoreKit.
            # It must not demote a different, independently active subscription.
            await refresh_entitlement(account)
            return {"quota": await asyncio.to_thread(database.quota, account["id"])}
        await asyncio.to_thread(database.subscription, account["id"], result.original_id, result.expires)
        return {"quota": await asyncio.to_thread(database.quota, account["id"])}

    @app.post("/v1/transcriptions")
    async def transcribe(request: Request, account=Depends(session)):
        # Bound parser and keep its spool entirely in RAM; only ffprobe uses an ephemeral file.
        class MemoryParser(MultiPartParser):
            spool_max_size = settings.max_audio_bytes + 1024 * 1024
        if not request.headers.get("content-type", "").startswith("multipart/form-data"):
            raise APIError(400, "invalid_request", "Format rekaman tidak valid.")
        try:
            form = await MemoryParser(request.headers, request.stream(), max_files=1, max_fields=3, max_part_size=65536).parse()
        except (MultiPartException, ValueError):
            raise APIError(400, "invalid_request", "Format rekaman tidak valid.") from None
        owner, request_id = None, None
        try:
            if set(form.keys()) - {"file", "requestID", "dictionary", "language"} or len(list(form.multi_items())) != len(form):
                raise ValueError("Unexpected or repeated fields")
            upload = form.get("file")
            if not isinstance(upload, UploadFile):
                raise ValueError("Missing audio")
            suffix = Path(upload.filename or "").suffix.lower()
            if suffix not in {".m4a", ".wav"}:
                raise APIError(400, "invalid_audio", "Gunakan rekaman audio m4a atau wav.")
            audio = await upload.read(settings.max_audio_bytes + 1)
            if not audio or len(audio) > settings.max_audio_bytes:
                raise APIError(413, "upload_too_large", "Rekaman terlalu besar atau kosong.")
            request_id = str(UUID(str(form["requestID"])))
            language = str(form.get("language", "id-ID"))
            if not re.fullmatch(r"[a-z]{2,3}(?:-[A-Za-z]{2,8}){0,2}", language):
                raise ValueError("Invalid locale")
            raw_dictionary = json.loads(str(form.get("dictionary", "[]")))
            if not isinstance(raw_dictionary, list) or len(raw_dictionary) > 100:
                raise ValueError("Invalid dictionary")
            dictionary = [DictionaryEntry.model_validate(entry).model_dump() for entry in raw_dictionary]
            for entry in dictionary:
                for value in entry.values():
                    if value != value.strip() or not value.strip() or any(ord(char) < 32 for char in value):
                        raise ValueError("Invalid dictionary text")
            fingerprint = hashlib.sha256(audio + json.dumps({"language": language, "dictionary": dictionary},
                                                           sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            await refresh_entitlement(account)
            seconds = await asyncio.to_thread(duration_probe, audio, suffix, settings)
            owner = await asyncio.to_thread(database.reserve, account["id"], request_id, fingerprint, seconds)
            if isinstance(owner, dict):
                return owner
            text = await provider.bounded_transcribe(audio, "recording" + suffix, language, dictionary)
            if not isinstance(text, str) or not text.strip() or len(text) > 50000:
                raise APIError(502, "transcription_failed", "Hasil transkripsi tidak valid. Silakan coba lagi.")
            return await asyncio.to_thread(database.finish, account["id"], request_id, owner, text)
        except (KeyError, ValueError, TypeError, ValidationError):
            raise APIError(400, "invalid_request", "Data rekaman tidak valid.") from None
        finally:
            if isinstance(owner, str):
                await asyncio.shield(asyncio.to_thread(database.compensate, account["id"], request_id, owner))
            await form.close()

    return app
