class APIError(Exception):
    """Only constant, user-safe messages belong in this exception."""

    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message
        super().__init__(code)


def unavailable() -> APIError:
    return APIError(503, "service_unavailable", "Layanan belum siap. Coba lagi nanti.")


def unauthorized() -> APIError:
    return APIError(401, "unauthorized", "Silakan masuk kembali dengan Apple.")
