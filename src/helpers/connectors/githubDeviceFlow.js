// GitHub's device flow (spec §5.1): ask for a user code, then poll the token
// endpoint at GitHub's interval until the user enters the code, declines, or
// the code expires. No client secret: a GitHub App's device flow needs only
// the client id. Pure: the api, the clock and the sleep are injected.

const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
// GitHub's documented defaults when a reply leaves them out.
const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_EXPIRES_IN_S = 900;
// slow_down: "5 extra seconds are added to the minimum interval".
const SLOW_DOWN_STEP_MS = 5000;
// A poll that fails without an OAuth answer (offline, a 5xx, a timeout) is
// retried at the interval; this many in a row give up.
const MAX_TRANSIENT_POLL_FAILURES = 3;
// The code is entered here; the renderer opens it, so nothing else is accepted.
const VERIFICATION_ORIGIN = "https://github.com/";

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

// Waits `ms`, or less when `signal` aborts first. Never rejects: the caller
// checks the signal afterwards.
function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function createDeviceFlow({
  api,
  sleep: defaultSleep = abortableSleep,
  now: defaultNow = Date.now,
}) {
  function throwIfCancelled(signal) {
    if (signal?.aborted) throw codedError("oauth_cancelled");
  }

  async function startDeviceAuthorization({ clientId, signal, now = defaultNow } = {}) {
    throwIfCancelled(signal);
    const result = await api.deviceCode({ client_id: clientId }, { signal });
    throwIfCancelled(signal);
    if (!result.ok) {
      throw codedError(
        result.errorCode === "device_flow_disabled"
          ? "device_flow_disabled"
          : "token_exchange_failed"
      );
    }
    const data = result.data;
    const verificationUri = data.verification_uri;
    if (
      typeof data.device_code !== "string" ||
      !data.device_code ||
      typeof data.user_code !== "string" ||
      !data.user_code ||
      typeof verificationUri !== "string" ||
      !verificationUri.startsWith(VERIFICATION_ORIGIN)
    ) {
      throw codedError("token_exchange_failed");
    }
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri,
      expiresAt: now() + positiveNumber(data.expires_in, DEFAULT_EXPIRES_IN_S) * 1000,
      intervalMs: positiveNumber(data.interval, DEFAULT_INTERVAL_MS / 1000) * 1000,
    };
  }

  // Resolves { ok: true, token } with GitHub's token reply (access_token,
  // expires_in, refresh_token, refresh_token_expires_in, …), or throws a
  // coded error: oauth_cancelled, code_expired, oauth_denied,
  // device_flow_disabled or token_exchange_failed.
  async function pollForToken({
    clientId,
    deviceCode,
    intervalMs,
    expiresAt,
    signal,
    sleep = defaultSleep,
    now = defaultNow,
  }) {
    let interval = positiveNumber(intervalMs, DEFAULT_INTERVAL_MS);
    let transientFailures = 0;
    for (;;) {
      throwIfCancelled(signal);
      const remaining = expiresAt - now();
      if (remaining <= 0) throw codedError("code_expired");
      // Never sleep past the code's expiry just to find it expired.
      await sleep(Math.min(interval, remaining), signal);
      throwIfCancelled(signal);
      if (now() >= expiresAt) throw codedError("code_expired");

      const result = await api.accessToken(
        { client_id: clientId, device_code: deviceCode, grant_type: DEVICE_GRANT_TYPE },
        { signal }
      );
      throwIfCancelled(signal);

      if (result.ok) {
        if (typeof result.data?.access_token === "string" && result.data.access_token) {
          return { ok: true, token: result.data };
        }
        throw codedError("token_exchange_failed");
      }
      switch (result.errorCode) {
        case "authorization_pending":
          transientFailures = 0;
          continue;
        case "slow_down":
          transientFailures = 0;
          // GitHub's new interval when it sends one, and never faster than
          // five seconds more than before.
          interval = Math.max(interval + SLOW_DOWN_STEP_MS, positiveNumber(result.intervalMs, 0));
          continue;
        case "expired_token":
          throw codedError("code_expired");
        case "access_denied":
          throw codedError("oauth_denied");
        case "device_flow_disabled":
          throw codedError("device_flow_disabled");
        default:
          break;
      }
      // GitHub said no in a way we don't expect (incorrect_device_code,
      // unsupported_grant_type, a bare 4xx): waiting will not change it.
      // No answer (offline, a timeout, a reset) or a 5xx may pass.
      const saidNo = result.refused === true || /^http_4\d\d$/.test(result.errorCode ?? "");
      if (saidNo) throw codedError("token_exchange_failed");
      transientFailures += 1;
      if (transientFailures > MAX_TRANSIENT_POLL_FAILURES) {
        throw codedError("token_exchange_failed");
      }
    }
  }

  return { startDeviceAuthorization, pollForToken };
}

module.exports = {
  createDeviceFlow,
  DEVICE_GRANT_TYPE,
  DEFAULT_INTERVAL_MS,
  DEFAULT_EXPIRES_IN_S,
  SLOW_DOWN_STEP_MS,
  MAX_TRANSIENT_POLL_FAILURES,
};
