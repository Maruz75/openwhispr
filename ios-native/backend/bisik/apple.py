import asyncio
import hashlib
import hmac
import time
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

import httpx
import jwt
from cryptography.fernet import Fernet

from .config import Settings
from .errors import APIError, unauthorized, unavailable


@dataclass(frozen=True)
class Identity:
    subject: str
    expires: float


class AppleIdentity:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.jwks = jwt.PyJWKClient("https://appleid.apple.com/auth/keys", cache_keys=True,
                                    lifespan=300, timeout=8)

    def _decode(self, token: str):
        if not self.settings.bundle_id:
            raise unavailable()
        try:
            key = self.jwks.get_signing_key_from_jwt(token).key
            return jwt.decode(token, key, algorithms=["RS256"],
                              issuer="https://appleid.apple.com", audience=self.settings.bundle_id,
                              options={"require": ["exp", "iat", "iss", "aud", "sub"]}, leeway=15)
        except jwt.PyJWKClientConnectionError:
            raise unavailable() from None
        except Exception:
            raise unauthorized() from None

    async def verify(self, token: str, raw_nonce: str) -> Identity:
        claims = await asyncio.to_thread(self._decode, token)
        expected = hashlib.sha256(raw_nonce.encode()).hexdigest()
        nonce = claims.get("nonce")
        if (not isinstance(nonce, str) or not hmac.compare_digest(nonce, expected)
                or not isinstance(claims.get("sub"), str) or not claims["sub"]
                or time.time() - claims["iat"] > 600):
            raise unauthorized()
        return Identity(claims["sub"], float(claims["exp"]))

    def _client_secret(self):
        if not self.settings.signin_ready():
            raise unavailable()
        now = int(time.time())
        try:
            return jwt.encode({"iss": self.settings.signin_team_id, "iat": now, "exp": now + 300,
                               "aud": "https://appleid.apple.com", "sub": self.settings.bundle_id},
                              Path(self.settings.signin_private_key_path).read_bytes(), algorithm="ES256",
                              headers={"kid": self.settings.signin_key_id})
        except Exception:
            raise unavailable() from None

    def _fernet(self):
        try:
            return Fernet(self.settings.refresh_encryption_key.encode())
        except Exception:
            raise unavailable() from None

    async def exchange(self, code: str, identity: Identity) -> str:
        secret, cipher = self._client_secret(), self._fernet()
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
                response = await client.post("https://appleid.apple.com/auth/token", data={
                    "client_id": self.settings.bundle_id, "client_secret": secret,
                    "code": code, "grant_type": "authorization_code"})
                if response.status_code >= 500:
                    raise unavailable()
                if response.status_code != 200:
                    raise unauthorized()
                data = response.json()
                claims = await asyncio.to_thread(self._decode, data["id_token"])
                if claims["sub"] != identity.subject or not isinstance(data.get("refresh_token"), str):
                    raise unauthorized()
                return cipher.encrypt(data["refresh_token"].encode()).decode()
        except APIError:
            raise
        except Exception:
            raise unavailable() from None

    async def revoke(self, ciphertext: str):
        secret = self._client_secret()
        try:
            refresh = self._fernet().decrypt(ciphertext.encode()).decode()
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
                response = await client.post("https://appleid.apple.com/auth/revoke", data={
                    "client_id": self.settings.bundle_id, "client_secret": secret,
                    "token": refresh, "token_type_hint": "refresh_token"})
                if response.status_code != 200:
                    raise unavailable()
        except APIError:
            raise
        except Exception:
            raise unavailable() from None


@dataclass(frozen=True)
class Entitlement:
    original_id: str
    expires: float


class AppleSubscriptions:
    """No entitlement is granted solely from a client-provided signed transaction."""

    def __init__(self, settings: Settings):
        self.settings = settings

    def _components(self):
        if not self.settings.apple_ready():
            raise unavailable()
        from appstoreserverlibrary.api_client import AsyncAppStoreServerAPIClient
        from appstoreserverlibrary.models.Environment import Environment
        from appstoreserverlibrary.signed_data_verifier import SignedDataVerifier
        try:
            env = Environment(self.settings.apple_environment)
            verifier = SignedDataVerifier([Path(p).read_bytes() for p in self.settings.apple_root_paths],
                                          True, env, self.settings.bundle_id, self.settings.apple_app_id)
            client = AsyncAppStoreServerAPIClient(Path(self.settings.apple_private_key_path).read_bytes(),
                                                 self.settings.apple_key_id, self.settings.apple_issuer_id,
                                                 self.settings.bundle_id, env)
            return verifier, client
        except Exception:
            raise unavailable() from None

    def _account_match(self, transaction, account: str):
        try:
            return str(UUID(str(transaction.appAccountToken))) == str(UUID(account))
        except (ValueError, TypeError, AttributeError):
            return False

    def _allowed(self, transaction, account: str) -> bool:
        from appstoreserverlibrary.models.Type import Type
        return (transaction.bundleId == self.settings.bundle_id
                and transaction.productId in self.settings.product_ids
                and transaction.type == Type.AUTO_RENEWABLE_SUBSCRIPTION
                and self._account_match(transaction, account))

    async def verify(self, signed_transaction: str, account: str) -> Entitlement | None:
        verifier, client = self._components()
        try:
            try:
                submitted = await asyncio.to_thread(verifier.verify_and_decode_signed_transaction, signed_transaction)
            except Exception:
                raise APIError(400, "invalid_transaction", "Transaksi App Store tidak dapat diverifikasi.") from None
            if not self._allowed(submitted, account) or not submitted.originalTransactionId:
                raise APIError(403, "transaction_mismatch", "Transaksi tidak cocok dengan akun ini.")
            return await self._current(verifier, client, str(submitted.originalTransactionId), account)
        finally:
            await client.async_close()

    async def refresh(self, original_id: str, account: str) -> Entitlement | None:
        verifier, client = self._components()
        try:
            return await self._current(verifier, client, original_id, account)
        finally:
            await client.async_close()

    async def _current(self, verifier, client, original_id: str, account: str) -> Entitlement | None:
        from appstoreserverlibrary.models.Status import Status
        try:
            response = await asyncio.wait_for(client.get_all_subscription_statuses(original_id), timeout=20)
            if (response.bundleId != self.settings.bundle_id
                    or response.environment.value != self.settings.apple_environment
                    or (self.settings.apple_environment == "Production" and response.appAppleId != self.settings.apple_app_id)):
                raise unavailable()
            candidates = []
            for group in response.data or []:
                for item in group.lastTransactions or []:
                    if str(item.originalTransactionId) != original_id or not item.signedTransactionInfo:
                        continue
                    decoded = await asyncio.to_thread(verifier.verify_and_decode_signed_transaction, item.signedTransactionInfo)
                    # A status response is server-authenticated; its embedded transaction still needs JWS verification.
                    if str(decoded.originalTransactionId) != original_id or not self._allowed(decoded, account):
                        raise APIError(403, "transaction_mismatch", "Transaksi tidak cocok dengan akun ini.")
                    candidates.append((decoded.signedDate or 0, decoded.purchaseDate or 0, item.status, decoded))
            if not candidates:
                return None
            _, _, status, latest = max(candidates, key=lambda value: (value[0], value[1]))
            now_ms = time.time() * 1000
            if (status != Status.ACTIVE or latest.revocationDate is not None or latest.isUpgraded
                    or not latest.expiresDate or latest.expiresDate <= now_ms
                    or not latest.purchaseDate or latest.purchaseDate > now_ms + 30000):
                return None
            return Entitlement(original_id, latest.expiresDate / 1000)
        except APIError:
            raise
        except Exception:
            raise unavailable() from None
