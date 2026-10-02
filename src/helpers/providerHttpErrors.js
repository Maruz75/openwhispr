// ESM like emailCompose.js: imported by the renderer and loaded by the main
// process through require(esm). Pure on purpose (no electron, no logger) so
// both sides classify a provider failure the same way.

export const PROVIDER_ERROR_CODES = Object.freeze({
  AUTH_FAILED: "PROVIDER_AUTH_FAILED",
  ACCESS_DENIED: "PROVIDER_ACCESS_DENIED",
  QUOTA_EXHAUSTED: "PROVIDER_QUOTA_EXHAUSTED",
  RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  MODEL_NOT_FOUND: "PROVIDER_MODEL_NOT_FOUND",
  PAYLOAD_TOO_LARGE: "PROVIDER_PAYLOAD_TOO_LARGE",
  BAD_REQUEST: "PROVIDER_BAD_REQUEST",
  UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  TIMEOUT: "PROVIDER_TIMEOUT",
  UNREACHABLE: "PROVIDER_UNREACHABLE",
  ERROR: "PROVIDER_ERROR",
  KEY_MISSING: "API_KEY_MISSING",
});

const C = PROVIDER_ERROR_CODES;

export const PROVIDER_SETTINGS_TARGETS = Object.freeze(["speechToText", "llms"]);

export const isProviderSettingsTarget = (value) => PROVIDER_SETTINGS_TARGETS.includes(value);

const SETTINGS_TARGET_BY_SURFACE = { transcription: "speechToText", llm: "llms" };

// Only failures the user fixes in Settings get the deep link.
const FIXABLE = new Set([
  C.AUTH_FAILED,
  C.ACCESS_DENIED,
  C.QUOTA_EXHAUSTED,
  C.MODEL_NOT_FOUND,
  C.KEY_MISSING,
]);

const MESSAGE_KEYS = {
  [C.AUTH_FAILED]: "providerErrors.authFailed",
  [C.ACCESS_DENIED]: "providerErrors.accessDenied",
  [C.QUOTA_EXHAUSTED]: "providerErrors.quotaExhausted",
  [C.RATE_LIMITED]: "hooks.audioRecording.errorDescriptions.providerRateLimited",
  [C.MODEL_NOT_FOUND]: "providerErrors.modelNotFound",
  [C.PAYLOAD_TOO_LARGE]: "providerErrors.payloadTooLarge",
  [C.BAD_REQUEST]: "providerErrors.badRequest",
  [C.UNAVAILABLE]: "providerErrors.unavailable",
  [C.TIMEOUT]: "providerErrors.timeout",
  [C.UNREACHABLE]: "providerErrors.unreachable",
  [C.ERROR]: "providerErrors.unknown",
};

// English twins of the en locale strings: Error.message is what History rows,
// logs and key-less surfaces show, so it reads as a sentence, not a status dump.
const ENGLISH = {
  [C.AUTH_FAILED]: "{{provider}} rejected your API key.",
  [C.ACCESS_DENIED]: "{{provider}} denied access. Your key may not include this model.",
  [C.QUOTA_EXHAUSTED]: "Your {{provider}} account is out of credit.",
  [C.RATE_LIMITED]: "{{provider}} rate-limited the request. Wait a moment and try again.",
  [C.MODEL_NOT_FOUND]: '{{provider}} doesn\'t recognize the model "{{model}}".',
  modelNotFoundNoModel: "{{provider}} doesn't recognize the selected model.",
  [C.PAYLOAD_TOO_LARGE]: "This recording is too large for {{provider}}.",
  [C.BAD_REQUEST]: "{{provider}} couldn't process this request.",
  [C.UNAVAILABLE]: "{{provider}} is having problems right now. Try again shortly.",
  [C.TIMEOUT]: "{{provider}} took too long to respond.",
  [C.UNREACHABLE]: "Couldn't reach {{provider}}. Check your connection.",
  [C.ERROR]: "{{provider}} returned an unexpected error.",
  [C.KEY_MISSING]: "No API key is set for {{provider}}.",
};

const SELF_HOSTED_NAME = "Your server";

const INVALID_KEY_SIGNAL =
  /invalid[ _-]?(x-)?api[ _-]?key|incorrect api key|api_key_invalid|authentication_error|unauthorized/i;
// Deliberately not bare "quota": Gemini words per-minute rate limits as "Quota exceeded".
const QUOTA_SIGNAL =
  /insufficient_quota|exceeded your current quota|billing|credit balance|insufficient (credits|balance|funds)|out of credits|payment required/i;
const MODEL_SIGNAL =
  /model_not_found|model[^.\n]{0,80}(not found|does not exist|not available|is not supported)|(unknown|invalid|unsupported) model/i;

const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);

const MAX_DETAIL_CHARS = 500;

const SECRET_PATTERNS = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/gi, "Bearer [redacted]"],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_*.-]{4,}/g, "[redacted]"],
  [/\bgsk_[A-Za-z0-9*]{4,}/g, "[redacted]"],
  [/\bAIza[A-Za-z0-9_-]{4,}/g, "[redacted]"],
  [/\bxai-[A-Za-z0-9*]{4,}/g, "[redacted]"],
];

function bodyToText(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

export function redactProviderBody(body) {
  let text = bodyToText(body);
  if (/<\s*(!doctype|html|body|head)\b/i.test(text)) return "<HTML response>";
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}…` : text;
}

function readHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) || undefined;
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  return match ? headers[match] : undefined;
}

function requestIdFrom(headers) {
  return (
    readHeader(headers, "x-request-id") ||
    readHeader(headers, "request-id") ||
    readHeader(headers, "cf-ray")
  );
}

function codeForStatus(status, text, selfHosted) {
  if (status === 401) return C.AUTH_FAILED;
  if ((status === 400 || status === 403) && INVALID_KEY_SIGNAL.test(text)) return C.AUTH_FAILED;
  if (status === 402) return C.QUOTA_EXHAUSTED;
  if ([400, 403, 429].includes(status) && QUOTA_SIGNAL.test(text)) return C.QUOTA_EXHAUSTED;
  if (status === 403) return C.ACCESS_DENIED;
  if (status === 429) return C.RATE_LIMITED;
  if (status === 404) {
    // A self-hosted 404 is far more often a wrong URL than a wrong model.
    return selfHosted && !MODEL_SIGNAL.test(text) ? C.ERROR : C.MODEL_NOT_FOUND;
  }
  if (status === 400 && MODEL_SIGNAL.test(text)) return C.MODEL_NOT_FOUND;
  if (status === 413) return C.PAYLOAD_TOO_LARGE;
  if ([400, 415, 422].includes(status)) return C.BAD_REQUEST;
  if (status === 408 || status === 504) return C.TIMEOUT;
  if (status >= 500 && status < 600) return C.UNAVAILABLE;
  return C.ERROR;
}

function buildClassification(code, { provider, model, surface, selfHosted, technicalDetails }) {
  const providerName = selfHosted ? SELF_HOSTED_NAME : provider;
  const messageParams = { provider: providerName };
  let messageKey = MESSAGE_KEYS[code];
  if (code === C.MODEL_NOT_FOUND) {
    if (model) messageParams.model = model;
    else messageKey = "providerErrors.modelNotFoundNoModel";
  }
  if (code === C.KEY_MISSING) {
    messageKey =
      surface === "transcription"
        ? "hooks.audioRecording.errorDescriptions.providerKeyMissing"
        : "providerErrors.keyMissing";
  }
  if (selfHosted) messageParams.selfHosted = true;
  const settingsTarget = FIXABLE.has(code) ? SETTINGS_TARGET_BY_SURFACE[surface] : undefined;
  return {
    code,
    messageKey,
    messageParams,
    surface,
    ...(settingsTarget ? { settingsTarget } : {}),
    technicalDetails: { provider: providerName, ...(technicalDetails || {}) },
  };
}

function englishMessage(classification) {
  const { code, messageParams } = classification;
  const template =
    code === C.MODEL_NOT_FOUND && !messageParams.model ? ENGLISH.modelNotFoundNoModel : ENGLISH[code];
  return template
    .replace("{{provider}}", messageParams.provider)
    .replace("{{model}}", messageParams.model ?? "");
}

function toError(classification, extra = {}) {
  return Object.assign(new Error(englishMessage(classification)), classification, extra);
}

export function classifyProviderHttpError({
  provider,
  status,
  body,
  headers,
  model,
  surface,
  selfHosted = false,
}) {
  const text = bodyToText(body);
  const underlyingError = redactProviderBody(text);
  const requestId = requestIdFrom(headers);
  return buildClassification(codeForStatus(status, text, selfHosted), {
    provider,
    model,
    surface,
    selfHosted,
    technicalDetails: {
      status,
      ...(requestId ? { requestId } : {}),
      ...(underlyingError ? { underlyingError } : {}),
    },
  });
}

export function providerHttpError(args) {
  return toError(classifyProviderHttpError(args), {
    status: args.status,
    provider: args.provider,
  });
}

export function providerError(code, ctx) {
  return toError(buildClassification(code, ctx), { provider: ctx.provider });
}

export function asProviderError(err, ctx) {
  if (!err || typeof err !== "object" || err.messageKey || err.name === "AbortError") return err;
  const inner = err.name === "AI_RetryError" && err.lastError ? err.lastError : err;
  let classified = null;
  if (typeof inner.statusCode === "number") {
    classified = providerHttpError({
      ...ctx,
      status: inner.statusCode,
      body: inner.responseBody ?? inner.message,
      headers: inner.responseHeaders,
    });
  } else if (inner.code === "LLM_REQUEST_TIMEOUT" || inner.name === "TimeoutError") {
    classified = providerError(C.TIMEOUT, ctx);
  } else if (
    NETWORK_CODES.has(inner.code) ||
    NETWORK_CODES.has(inner.cause?.code) ||
    (inner instanceof TypeError && /failed to fetch|fetch failed|network/i.test(inner.message))
  ) {
    classified = providerError(C.UNREACHABLE, ctx);
  }
  if (!classified) return err;
  classified.cause = err;
  return classified;
}
