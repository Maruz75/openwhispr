// Gmail login and tokens (spec §5.1). The OAuth flow is ported from #1819's
// gmailOAuth.js (Gabriel Stein). Plan 3 adds the granted-scope and verified-
// email checks, the refresh bound to one login, and revoking the grant.
const { describeError } = require("./errorSummary");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
// gmail.send is Google's only sensitive (not restricted) Gmail scope. Any
// read, compose or modify scope would need a CASA assessment (spec §3).
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_SCOPES = `openid email ${GMAIL_SEND_SCOPE}`;
// Google desktop clients accept http://127.0.0.1 on any port with no path,
// so there is no relay. A first sign-in (account choice, 2FA, the
// unverified-app screen) can outlast the calendars' 120 s.
const GMAIL_LOOPBACK = { ports: [0], callbackPath: "", timeoutMs: 5 * 60 * 1000 };
// Access tokens live an hour. Refreshing 5 minutes early keeps a send from
// starting with a token that expires on the way.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;
// The one token-endpoint error that means the login itself is gone: access
// revoked at myaccount.google.com, a password change, or a Testing-status
// project's 7-day expiry. Every other error keeps the login.
const OAUTH_LOGIN_GONE = new Set(["invalid_grant"]);
// Google refused the OAuth client itself, or the build has none: a
// configuration fault, not the user's login, and asking again won't help.
const CLIENT_REFUSED = new Set(["invalid_client", "unauthorized_client", "not_configured"]);

// A complete GMAIL_* pair overrides the calendar's client, which lives in
// the same Google Cloud project, so CI and release configs need no new
// secrets. The fallback is pair-wise: an id from one client with another's
// secret is a pair Google refuses (invalid_client), so half a pair is ignored.
function gmailClientCredentials(env) {
  for (const [idKey, secretKey] of [
    ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"],
    ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"],
  ]) {
    const clientId = env?.[idKey];
    const clientSecret = env?.[secretKey];
    if (clientId && clientSecret) return { clientId, clientSecret };
  }
  return { clientId: null, clientSecret: null };
}

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

// Without expires_in the token counts as already stale, so its first use
// refreshes it instead of trusting it forever.
function parseTokens(data, at) {
  if (!nonEmptyString(data?.access_token)) return null;
  return {
    accessToken: data.access_token,
    refreshToken: nonEmptyString(data.refresh_token) ? data.refresh_token : null,
    expiresAt: Number.isFinite(data.expires_in) ? at + data.expires_in * 1000 : at,
    scope: typeof data.scope === "string" ? data.scope : null,
  };
}

// Google returns granted scopes as full URLs, space separated, in any order,
// so only an exact match counts.
function grantsSend(scope) {
  return typeof scope === "string" && scope.split(/\s+/).includes(GMAIL_SEND_SCOPE);
}

// The id_token comes straight from Google's token endpoint over TLS, which
// is what lets its claims be read without checking the signature (OIDC Core
// §3.1.3.7). An id_token from anywhere else must never be read this way.
function idTokenClaims(idToken) {
  try {
    const claims = JSON.parse(
      Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")
    );
    return claims && typeof claims === "object" ? claims : null;
  } catch {
    return null;
  }
}

// Only the Google login a pending action was approved under may act for it.
function sameLogin(entry, binding) {
  return Boolean(
    entry &&
    binding &&
    entry.generation === binding.generation &&
    entry.credential.sub === binding.accountId
  );
}

function createGmailAuth({
  api,
  credentials,
  getClientCredentials,
  runOAuthLoopbackFlow,
  OAuthFlowError,
  renderResultPage = null,
  // Optional: told about failures worth a log line via
  // logger.warn(message, { errorName, errorCode }, area). Never a token, an
  // address or a raw error.message.
  logger = null,
  now = Date.now,
}) {
  const refreshes = new Map();

  function oauthClient() {
    const { clientId, clientSecret } = getClientCredentials() ?? {};
    return nonEmptyString(clientId) && nonEmptyString(clientSecret)
      ? { clientId, clientSecret }
      : null;
  }

  function isConfigured() {
    return oauthClient() !== null;
  }

  // Best effort: the local login goes whatever Google answers.
  async function revokeToken(token) {
    if (!nonEmptyString(token)) return;
    try {
      await api.revokeToken(token);
    } catch (error) {
      logger?.warn("gmail revoke failed", describeError(error), "connectors");
    }
  }

  // `signal` gives the sign-in up when a newer Connect replaces it.
  function authorize({ signal } = {}) {
    const client = oauthClient();
    // Fail before opening a browser on a client_id-less URL.
    if (!client) return Promise.reject(codedError("not_configured"));
    return runOAuthLoopbackFlow({
      errorParam: "gmail_error",
      ...GMAIL_LOOPBACK,
      renderResultPage,
      signal,
      buildAuthUrl: (redirectUri, state, codeChallenge) => {
        const params = new URLSearchParams({
          client_id: client.clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: GMAIL_SCOPES,
          access_type: "offline",
          prompt: "consent",
          // Only gmail.send, never scopes granted to this client before.
          include_granted_scopes: "false",
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        });
        return `${GOOGLE_AUTH_URL}?${params.toString()}`;
      },
      handleCallback: async (code, redirectUri, codeVerifier) => {
        const exchanged = await api.exchangeToken({
          code,
          client_id: client.clientId,
          client_secret: client.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        });
        if (!exchanged.ok) {
          throw new OAuthFlowError("token_exchange_failed", "gmail_token_exchange_failed");
        }
        const data = exchanged.data ?? {};
        // A grant Google issued that can't become a login is revoked at once,
        // not left live at Google with nothing using it.
        const refuse = async (redirectCode) => {
          await revokeToken(
            nonEmptyString(data.refresh_token) ? data.refresh_token : data.access_token
          );
          return new OAuthFlowError(redirectCode, `gmail_${redirectCode}`);
        };
        const tokens = parseTokens(data, now());
        if (!tokens || !tokens.refreshToken || !nonEmptyString(data.id_token)) {
          throw await refuse("token_exchange_failed");
        }
        // Granular consent lets the user untick "Send email on your behalf".
        if (!grantsSend(tokens.scope)) throw await refuse("permission_not_granted");
        const claims = idTokenClaims(data.id_token);
        if (
          claims?.email_verified !== true ||
          !nonEmptyString(claims.email) ||
          !nonEmptyString(claims.sub)
        ) {
          throw await refuse("email_not_verified");
        }
        return {
          email: claims.email,
          sub: claims.sub,
          refreshToken: tokens.refreshToken,
          accessToken: tokens.accessToken,
          expiresAt: tokens.expiresAt,
          scope: tokens.scope,
          needsReconnect: false,
        };
      },
    });
  }

  // Flags the login the binding names, and only it, as needing a reconnect.
  // A reconnect or disconnect that landed first wins, and nothing is
  // written to it.
  function markReconnect(binding) {
    const entry = credentials.read(binding?.ownerAccountId ?? null, "gmail");
    if (!sameLogin(entry, binding)) return { ok: false, errorCode: "connection_changed" };
    try {
      credentials.save(
        binding.ownerAccountId,
        "gmail",
        { ...entry.credential, needsReconnect: true },
        binding.generation
      );
    } catch (error) {
      if (error.code === "connection_changed" || error.code === "signed_out") {
        return { ok: false, errorCode: "connection_changed" };
      }
      // A real write failure (disk, permission, encryption). Google's answer
      // still stands: the login is gone, though the flag wasn't recorded.
      logger?.warn("gmail reconnect flag save failed", describeError(error), "connectors");
    }
    return { ok: false, errorCode: "reconnect_needed" };
  }

  async function requestRefresh(refreshToken) {
    const client = oauthClient();
    if (!client) return { ok: false, errorCode: "not_configured" };
    const result = await api.exchangeToken({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    if (!result.ok) return { ok: false, errorCode: result.errorCode };
    const tokens = parseTokens(result.data, now());
    return tokens ? { ok: true, tokens } : { ok: false, errorCode: "bad_response" };
  }

  const stillBound = (binding) =>
    sameLogin(credentials.read(binding.ownerAccountId, "gmail"), binding);

  async function refresh(binding, credential) {
    if (!credential.refreshToken) return markReconnect(binding);
    let result = await requestRefresh(credential.refreshToken);
    // Network errors, 5xx, temporarily_unavailable and unreadable answers
    // may pass. Google refresh tokens aren't single-use, so asking again is
    // safe, but only while the login this refresh started with still holds.
    if (
      !result.ok &&
      !OAUTH_LOGIN_GONE.has(result.errorCode) &&
      !CLIENT_REFUSED.has(result.errorCode) &&
      stillBound(binding)
    ) {
      result = await requestRefresh(credential.refreshToken);
    }
    if (!result.ok) {
      // A reconnect or disconnect that landed while the request was out
      // always wins: nothing is written for the old login.
      if (!stillBound(binding)) return { ok: false, errorCode: "connection_changed" };
      if (OAUTH_LOGIN_GONE.has(result.errorCode)) return markReconnect(binding);
      if (CLIENT_REFUSED.has(result.errorCode)) {
        logger?.warn(
          "gmail oauth client refused",
          { errorName: "GoogleOAuthError", errorCode: result.errorCode },
          "connectors"
        );
        return { ok: false, errorCode: "gmail_unavailable" };
      }
      return { ok: false, errorCode: "network" };
    }
    const next = {
      ...credential,
      accessToken: result.tokens.accessToken,
      expiresAt: result.tokens.expiresAt,
      // Google keeps the refresh token unless it sends a new one.
      refreshToken: result.tokens.refreshToken ?? credential.refreshToken,
      scope: result.tokens.scope ?? credential.scope,
      needsReconnect: false,
    };
    // Saved before use, and only into the slot and generation this refresh
    // started from: a reconnect or disconnect that landed meanwhile wins.
    try {
      credentials.save(binding.ownerAccountId, "gmail", next, binding.generation);
    } catch (error) {
      if (error.code === "connection_changed" || error.code === "signed_out") {
        return { ok: false, errorCode: "connection_changed" };
      }
      logger?.warn("gmail token save failed", describeError(error), "connectors");
      return { ok: false, errorCode: "credential_save_failed" };
    }
    return { ok: true, token: next.accessToken, credential: next };
  }

  async function getAccessToken(binding, { forceRefresh = false } = {}) {
    const entry = credentials.read(binding?.ownerAccountId ?? null, "gmail");
    if (!sameLogin(entry, binding)) return { ok: false, errorCode: "connection_changed" };
    const { credential } = entry;
    if (credential.needsReconnect) return { ok: false, errorCode: "reconnect_needed" };
    const fresh = credential.expiresAt - EXPIRY_SKEW_MS > now();
    if (fresh && !forceRefresh) return { ok: true, token: credential.accessToken, credential };
    // Concurrent callers for one login share one refresh.
    const key = `${binding.ownerAccountId}:${binding.generation}`;
    let pending = refreshes.get(key);
    if (!pending) {
      pending = refresh(binding, credential).finally(() => refreshes.delete(key));
      refreshes.set(key, pending);
    }
    return pending;
  }

  // Revoking the refresh token ends the whole grant, access tokens included.
  // An expired access token can't be revoked (400 invalid_token), so it is
  // only the fallback.
  async function revoke(credential) {
    await revokeToken(
      nonEmptyString(credential?.refreshToken) ? credential.refreshToken : credential?.accessToken
    );
  }

  function statusOf(credential) {
    return {
      connected: true,
      accountLabel: credential.email ?? null,
      workspaceLabel: null,
      needsReconnect: Boolean(credential.needsReconnect),
    };
  }

  return { authorize, getAccessToken, markReconnect, revoke, statusOf, isConfigured };
}

module.exports = {
  createGmailAuth,
  gmailClientCredentials,
  GMAIL_SCOPES,
  GMAIL_SEND_SCOPE,
  GMAIL_LOOPBACK,
  OAUTH_LOGIN_GONE,
  EXPIRY_SKEW_MS,
};
