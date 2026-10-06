import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    database_path: str = "data/bisik.sqlite3"
    environment: str = "production"
    bundle_id: str = ""
    free_seconds: int = 900
    pro_seconds: int = 18000
    session_seconds: int = 30 * 86400
    cache_seconds: int = 300
    lease_seconds: int = 300
    max_audio_bytes: int = 24 * 1024 * 1024
    max_recording_seconds: int = 600
    ffprobe_path: str = "ffprobe"
    temp_directory: str | None = None
    stt_base_url: str = ""
    stt_api_key: str = ""
    stt_model: str = ""
    cleanup_base_url: str = ""
    cleanup_api_key: str = ""
    cleanup_model: str = ""
    product_ids: tuple[str, ...] = ("com.maruz75.bisik.pro.monthly", "com.maruz75.bisik.pro.annual")
    apple_environment: str = "Production"
    apple_app_id: int | None = None
    apple_root_paths: tuple[str, ...] = ()
    apple_key_id: str = ""
    apple_issuer_id: str = ""
    apple_private_key_path: str = ""
    signin_team_id: str = ""
    signin_key_id: str = ""
    signin_private_key_path: str = ""
    refresh_encryption_key: str = ""
    account_id_key: str = ""

    @classmethod
    def from_env(cls):
        load_dotenv(override=False)
        defaults = cls()
        values = {}
        ints = {"free_seconds", "pro_seconds", "session_seconds", "cache_seconds", "lease_seconds",
                "max_audio_bytes", "max_recording_seconds", "apple_app_id"}
        lists = {"product_ids", "apple_root_paths"}
        for name in cls.__dataclass_fields__:
            value = os.getenv("BISIK_" + name.upper())
            if value is None:
                continue
            if name in ints:
                values[name] = int(value) if value else getattr(defaults, name)
            elif name in lists:
                values[name] = tuple(part.strip() for part in value.split(",") if part.strip())
            else:
                values[name] = value or None if name == "temp_directory" else value
        result = cls(**values)
        if result.environment not in {"production", "development", "test"}:
            raise ValueError("Invalid BISIK_ENVIRONMENT")
        if min(result.free_seconds, result.pro_seconds, result.session_seconds,
               result.cache_seconds, result.max_audio_bytes, result.max_recording_seconds) <= 0:
            raise ValueError("Limits must be positive")
        if result.lease_seconds < 240:
            raise ValueError("Reservation lease must exceed the bounded provider deadline")
        return result

    def provider_ready(self) -> bool:
        if not all((self.stt_base_url, self.stt_api_key, self.stt_model)):
            return False
        urls = [self.stt_base_url]
        if self.cleanup_model:
            if not all((self.cleanup_base_url, self.cleanup_api_key)):
                return False
            urls.append(self.cleanup_base_url)
        return all(urlparse(url).scheme == "https" or
                   (self.environment != "production" and urlparse(url).scheme == "http"
                    and urlparse(url).hostname in {"localhost", "127.0.0.1"}) for url in urls)

    def apple_ready(self) -> bool:
        return bool(self.bundle_id and self.product_ids and self.apple_root_paths
                    and all(Path(p).is_file() for p in self.apple_root_paths)
                    and self.apple_key_id and self.apple_issuer_id
                    and Path(self.apple_private_key_path).is_file()
                    and self.apple_environment in {"Production", "Sandbox"}
                    and (self.apple_environment != "Production" or self.apple_app_id)
                    and (self.environment != "production" or self.apple_environment == "Production"))

    def signin_ready(self) -> bool:
        return bool(self.bundle_id and len(self.account_id_key.encode()) >= 32 and self.signin_team_id and self.signin_key_id
                    and Path(self.signin_private_key_path).is_file() and self.refresh_encryption_key)
