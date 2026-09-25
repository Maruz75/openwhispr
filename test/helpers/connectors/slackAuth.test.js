const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NOW,
  FIXTURES,
  CONNECTED,
  BINDING,
  fakeSlackFetch,
  ok,
  slackError,
  httpStatus,
  offline,
  memoryCredentials,
} = require("./slackFixtures");

const loadAuth = () => import("../../../src/helpers/connectors/slackAuth.js");
const loadApi = () => import("../../../src/helpers/connectors/slackApi.js");

class FakeFlowError extends Error {
  constructor(redirectCode, message) {
    super(message);
    this.redirectCode = redirectCode;
  }
}

const EXPIRED = { ...CONNECTED, expiresAt: NOW - 1 };

async function setup({
  script = {},
  credential = CONNECTED,
  fetchImpl,
  clientId = "123.456",
} = {}) {
  const [{ createSlackAuth }, { createSlackApi }] = await Promise.all([loadAuth(), loadApi()]);
  const slack = fakeSlackFetch(script);
  const credentials = memoryCredentials(credential);
  const flows = [];
  const auth = createSlackAuth({
    api: createSlackApi({ fetchImpl: fetchImpl ?? slack.fetchImpl, sleep: async () => {} }),
    credentials,
    getClientId: () => clientId,
    OAuthFlowError: FakeFlowError,
    now: () => NOW,
    // Like the real flow behind a relay: the public redirect URI goes to both calls.
    runOAuthLoopbackFlow: async (options) => {
      const redirectUri = options.publicRedirectUri ?? "http://127.0.0.1:5000";
      flows.push({
        options,
        authUrl: new URL(options.buildAuthUrl(redirectUri, "state-1", "challenge-1")),
      });
      return options.handleCallback("code-1", redirectUri, "verifier-1");
    },
  });
  const slot = () => credentials.read("acct-1", "slack")?.credential;
  return { auth, slack, credentials, flows, slot };
}

test("authorize asks for user scopes only, exchanges with the PKCE verifier, and saves nothing", async () => {
  const { auth, slack, credentials, flows } = await setup({
    credential: null,
    script: { "oauth.v2.access": [ok(FIXTURES.exchange)], "auth.test": [ok(FIXTURES.authTest)] },
  });

  const credential = await auth.authorize();

  const { authUrl, options } = flows[0];
  assert.equal(options.errorParam, "slack_error");
  assert.equal(options.publicRedirectUri, "https://openwhispr.com/auth/slack/callback");
  assert.deepEqual(options.ports, [0]);
  assert.equal(options.callbackPath, "/slack/callback");
  assert.equal(options.timeoutMs, 300000);
  assert.equal(authUrl.origin + authUrl.pathname, "https://slack.com/oauth/v2/authorize");
  assert.equal(
    authUrl.searchParams.get("redirect_uri"),
    "https://openwhispr.com/auth/slack/callback"
  );
  assert.match(authUrl.searchParams.get("user_scope"), /chat:write/);
  assert.equal(authUrl.searchParams.get("scope"), null, "no bot scopes");
  assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
  assert.deepEqual(slack.calls[0].params, {
    client_id: "123.456",
    code: "code-1",
    code_verifier: "verifier-1",
    redirect_uri: "https://openwhispr.com/auth/slack/callback",
  });
  assert.equal(slack.calls[1].authorization, "Bearer xoxe.xoxp-1-test-access");
  assert.deepEqual(credential, {
    accessToken: "xoxe.xoxp-1-test-access",
    refreshToken: "xoxe-1-test-refresh",
    expiresAt: NOW + 43200 * 1000,
    refreshIssuedAt: NOW,
    userId: "U0CHAD",
    userName: "chad",
    teamId: "T0TEST",
    teamName: "Acme Test",
    teamUrl: "https://acme-test.slack.com/",
    needsReconnect: false,
  });
  assert.equal(credentials.saves.length, 0);
});

test("authorize without a client id fails fast with not_configured", async () => {
  const { auth, flows } = await setup({ credential: null, clientId: "" });
  await assert.rejects(auth.authorize(), (error) => error.code === "not_configured");
  assert.equal(flows.length, 0);
});

test("the redirect override accepts only an https URL", async () => {
  const { slackRedirectUri, SLACK_RELAY_REDIRECT_URI } = await loadAuth();
  const preview =
    "https://openwhispr-website-git-feat-slack-oauth-relay.vercel.app/auth/slack/callback";

  assert.equal(slackRedirectUri({}), SLACK_RELAY_REDIRECT_URI);
  assert.equal(slackRedirectUri({ SLACK_OAUTH_REDIRECT_URI: preview }), preview);
  for (const rejected of [
    "http://127.0.0.1:5000/slack/callback",
    "javascript:alert(1)",
    "not a url",
    "",
  ]) {
    assert.equal(
      slackRedirectUri({ SLACK_OAUTH_REDIRECT_URI: rejected }),
      SLACK_RELAY_REDIRECT_URI,
      rejected
    );
  }
});

test("a token is handed out only for the login the action is bound to", async () => {
  const { auth, credentials, slack } = await setup();
  assert.equal((await auth.getAccessToken(BINDING)).token, "xoxe.xoxp-1-test-access");

  credentials.replace(
    "acct-1",
    "slack",
    { ...CONNECTED, userId: "U0BOB", accessToken: "xoxe.xoxp-bob" },
    1
  );
  assert.deepEqual(await auth.getAccessToken(BINDING), {
    ok: false,
    errorCode: "connection_changed",
  });
  assert.deepEqual(await auth.getAccessToken({ ...BINDING, ownerAccountId: "acct-2" }), {
    ok: false,
    errorCode: "connection_changed",
  });
  assert.deepEqual(slack.calls, []);
});

test("concurrent callers share one refresh, and the rotated token is saved before use", async () => {
  const { auth, slack, credentials } = await setup({
    credential: EXPIRED,
    script: { "oauth.v2.access": [ok(FIXTURES.refresh)] },
  });

  const [first, second] = await Promise.all([
    auth.getAccessToken(BINDING),
    auth.getAccessToken(BINDING),
  ]);

  assert.equal(slack.calls.length, 1);
  assert.deepEqual(slack.calls[0].params, {
    client_id: "123.456",
    grant_type: "refresh_token",
    refresh_token: "xoxe-1-test-refresh",
  });
  assert.equal(first.token, "xoxe.xoxp-1-test-access-2");
  assert.equal(second.token, "xoxe.xoxp-1-test-access-2");
  assert.equal(credentials.saves.length, 1);
  assert.equal(credentials.saves[0].refreshToken, "xoxe-1-test-refresh-2");
  assert.equal(credentials.generation("acct-1", "slack"), 1, "a refresh is not a new login");
});

test("forceRefresh refreshes a token that still looks valid", async () => {
  const { auth, slack } = await setup({ script: { "oauth.v2.access": [ok(FIXTURES.refresh)] } });
  const result = await auth.getAccessToken(BINDING, { forceRefresh: true });
  assert.equal(result.token, "xoxe.xoxp-1-test-access-2");
  assert.equal(slack.calls.length, 1);
});

test("Slack refusing the refresh token needs a reconnect, with no second attempt", async () => {
  const { auth, slack, slot } = await setup({
    credential: EXPIRED,
    script: { "oauth.v2.access": [slackError("invalid_refresh_token")] },
  });

  assert.deepEqual(await auth.getAccessToken(BINDING), {
    ok: false,
    errorCode: "reconnect_needed",
  });
  assert.equal(slot().needsReconnect, true);
  assert.equal(auth.statusOf(slot()).needsReconnect, true);
  assert.deepEqual(await auth.getAccessToken(BINDING), {
    ok: false,
    errorCode: "reconnect_needed",
  });
  assert.equal(slack.calls.length, 1);
});

test("rate limits and temporary Slack failures keep the login", async () => {
  for (const [reply, expectedCalls] of [
    [slackError("ratelimited"), 1],
    [slackError("service_unavailable"), 2],
    [slackError("internal_error"), 2],
    [httpStatus(503), 2],
    [offline(), 1],
  ]) {
    const { auth, slack, slot } = await setup({
      credential: EXPIRED,
      script: { "oauth.v2.access": [reply] },
    });
    const result = await auth.getAccessToken(BINDING);
    assert.equal(result.ok, false);
    assert.notEqual(result.errorCode, "reconnect_needed");
    assert.equal(slot().needsReconnect, false);
    assert.equal(auth.statusOf(slot()).needsReconnect, false);
    assert.equal(
      slack.calls.length,
      expectedCalls,
      JSON.stringify(reply.body ?? reply.status ?? "offline")
    );
  }
});

test("an uncertain refresh is asked once more at once, inside the grace period", async () => {
  const { auth, slack } = await setup({
    credential: EXPIRED,
    script: { "oauth.v2.access": [slackError("internal_error"), ok(FIXTURES.refresh)] },
  });
  assert.equal((await auth.getAccessToken(BINDING)).token, "xoxe.xoxp-1-test-access-2");
  assert.equal(slack.calls.length, 2);
});

test("a reconnect during a refresh is never overwritten by the old login", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started = false;
  const fetchImpl = async () => {
    started = true;
    await gate;
    return new Response(JSON.stringify(FIXTURES.refresh), { status: 200 });
  };
  const { auth, credentials, slot } = await setup({ credential: EXPIRED, fetchImpl });

  const pending = auth.getAccessToken(BINDING);
  while (!started) await new Promise((resolve) => setImmediate(resolve));
  credentials.replace(
    "acct-1",
    "slack",
    { ...CONNECTED, userId: "U0OTHER", accessToken: "xoxe.xoxp-other" },
    1
  );
  release();

  assert.deepEqual(await pending, { ok: false, errorCode: "connection_changed" });
  assert.equal(slot().accessToken, "xoxe.xoxp-other");
  assert.equal(credentials.saves.length, 0);
});

test("the status asks for a reconnect 30 days after the last refresh token", async () => {
  const { auth } = await setup();
  assert.deepEqual(auth.statusOf(CONNECTED), {
    connected: true,
    accountLabel: "chad",
    workspaceLabel: "Acme Test",
    needsReconnect: false,
  });
  const stale = { ...CONNECTED, refreshIssuedAt: NOW - 31 * 24 * 60 * 60 * 1000 };
  assert.equal(auth.statusOf(stale).needsReconnect, true);
});

test("revoke revokes the refresh token and the access token, and never throws offline", async () => {
  const online = await setup({ script: { "auth.revoke": [ok({ ok: true, revoked: true })] } });
  await online.auth.revoke(CONNECTED);
  assert.deepEqual(
    online.slack.calls.map((call) => [call.method, call.authorization]),
    [
      ["auth.revoke", "Bearer xoxe-1-test-refresh"],
      ["auth.revoke", "Bearer xoxe.xoxp-1-test-access"],
    ]
  );

  const offlineRevoke = await setup({ script: { "auth.revoke": [offline()] } });
  await assert.doesNotReject(offlineRevoke.auth.revoke(CONNECTED));
});
