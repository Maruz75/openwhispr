// What a connector's query returns goes to the model, and through it to the
// model's provider. A connector is third-party code and its items are other
// people's text, so only small, flat, typed values get through, and any cut
// says so.

const MAX_QUERY_ITEMS = 20;
const MAX_QUERY_ITEM_FIELDS = 16;
const MAX_QUERY_STRING_LENGTH = 1000;
const MAX_QUERY_LIST_ITEMS = 20;
const MAX_QUERY_LIST_STRING_LENGTH = 200;
const MAX_CANDIDATES = 20;

// Short identifiers only: no "__proto__", nothing a template would misread.
const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
// C0 control characters other than tab and line feed (terminal escapes, NUL, CR).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F]/g;
const ELLIPSIS = "…";

function queryFailed() {
  return { status: "failed", errorCode: "query_failed", message: "Couldn't search right now." };
}

function invalidResult() {
  return { status: "failed", errorCode: "invalid_result", message: "Couldn't read the results." };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

// At most `max` UTF-16 units, ellipsis included, never ending on half an emoji.
function cleanString(value, max, state) {
  const text = value.replace(CONTROL_CHARACTERS, "");
  if (text.length <= max) return text;
  state.truncated = true;
  let end = max - ELLIPSIS.length;
  if (isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
  return text.slice(0, end) + ELLIPSIS;
}

// undefined means "drop this field".
function cleanValue(value, state) {
  if (typeof value === "string") return cleanString(value, MAX_QUERY_STRING_LENGTH, state);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    const strings = value.filter((entry) => typeof entry === "string");
    if (strings.length > MAX_QUERY_LIST_ITEMS) state.truncated = true;
    return strings
      .slice(0, MAX_QUERY_LIST_ITEMS)
      .map((entry) => cleanString(entry, MAX_QUERY_LIST_STRING_LENGTH, state));
  }
  return undefined;
}

function cleanItem(item, state) {
  if (!isPlainObject(item)) return null;
  const clean = {};
  let kept = 0;
  for (const [name, value] of Object.entries(item)) {
    if (!FIELD_NAME.test(name)) continue;
    const cleaned = cleanValue(value, state);
    if (cleaned === undefined) continue;
    if (kept === MAX_QUERY_ITEM_FIELDS) {
      state.truncated = true;
      break;
    }
    clean[name] = cleaned;
    kept += 1;
  }
  return kept > 0 ? clean : null;
}

function normalizeQueryResult(result) {
  switch (result?.status) {
    case "ok": {
      if (!Array.isArray(result.items)) return invalidResult();
      const state = {
        truncated: result.truncated === true || result.items.length > MAX_QUERY_ITEMS,
      };
      const items = result.items
        .slice(0, MAX_QUERY_ITEMS)
        .map((item) => cleanItem(item, state))
        .filter(Boolean);
      return { status: "ok", items, truncated: state.truncated };
    }
    case "needs_clarification": {
      if (typeof result.message !== "string") return invalidResult();
      const state = { truncated: false };
      const candidates = Array.isArray(result.candidates) ? result.candidates : [];
      return {
        status: "needs_clarification",
        message: cleanString(result.message, MAX_QUERY_STRING_LENGTH, state),
        candidates: candidates
          .filter((candidate) => typeof candidate === "string")
          .slice(0, MAX_CANDIDATES)
          .map((candidate) => cleanString(candidate, MAX_QUERY_LIST_STRING_LENGTH, state)),
      };
    }
    case "failed": {
      const fallback = queryFailed();
      const state = { truncated: false };
      return {
        status: "failed",
        errorCode: typeof result.errorCode === "string" ? result.errorCode : fallback.errorCode,
        message:
          typeof result.message === "string"
            ? cleanString(result.message, MAX_QUERY_STRING_LENGTH, state)
            : fallback.message,
      };
    }
    default:
      return invalidResult();
  }
}

module.exports = {
  normalizeQueryResult,
  queryFailed,
  MAX_QUERY_ITEMS,
  MAX_QUERY_ITEM_FIELDS,
  MAX_QUERY_STRING_LENGTH,
  MAX_QUERY_LIST_ITEMS,
  MAX_QUERY_LIST_STRING_LENGTH,
};
