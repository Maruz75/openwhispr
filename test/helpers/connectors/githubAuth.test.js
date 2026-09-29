const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NOW,
  FIXTURES,
  CONNECTED,
  BINDING,
  fakeGithubFetch,
  json,
  reset,
  memoryCredentials,
} = require("./githubFixtures");

const loadAuth = () => import("../../../src/helpers/connectors/githubAuth.js");
const loadApi = () => import("../../../src/helpers/connectors/githubApi.js");

const DEVICE_CODE = "POST /login/device/code";
const TOKEN = "POST /login/oauth/access_token";
const USER = "GET /user";
const CLIENT_ID = "Iv1.test-client";
const STARTED = {
  deviceCode: "device-code-1",
  userCode: "WDJB-MJHT",
  verificationUri: "https://github.com/login/device",
  expiresAt: NOW + 15 * 60 * 1000,
  intervalMs: 5000,
};
// What GitHub's token endpoint returns for a GitHub App with token expiry on.
const ISSUED = {
  access_token: "ghu-new",
  expires_in: 28800,
  refresh_token: "ghr-new",
  refresh_token_expires_in: 15897600,
  scope: "",
  token_type: "bearer",
};
const DANA = json({ id: 42, login: "dana", name: "Dana Test" });
const REFRESHED = json({
  access_token: "ghu-2",
  expires_in: 28800,
  refresh_token: "ghr-2",
  refresh_token_expires_in: 15897600,
  scope: "",
  token_type: "bearer",
});
// GitHub answers OAuth errors with HTTP 200.
const oauthError = (error) => json({ error, error_description: "synthetic" });
const EXPIRED = { ...CONNECTED, expiresAt: NOW - 1 };
const OTHER_LOGIN = {
  ...CONNECTED,
  userId: 43,
  login: "sam",
  accessToken: "ghu-other",
  refreshToken: "ghr-other",
};
const CONNECTION_CHANGED = { ok: false, errorCode: "connection_changed" };
const RECONNECT_NEEDED = { ok: false, errorCode: "reconnect_needed" };

function coded(code) {
  return Object.assign(new Error(code), { code });
}

// Task 5's device flow is tested on its own; here it is scripted, so these
// tests pin what the login does with its answers.
function fakeDeviceFlow({
  start = async () => STARTED,
  poll = async () => ({ ok: true, token: ISSUED }),
  events = [],
} = {}) {
  const calls = { start: [], poll: [] };
  return {
    calls,
    startDeviceAuthorization: async (args) => {
      calls.start.push(args);
      events.push("start");
      return start(args);
    },
    pollForToken: async (args) => {
      calls.poll.push(args);
      events.push("poll");
      return poll(args);
    },
  };
}

function recordingLogger() {
  const lines = [];
  const log = (level) => (message, meta, area) => lines.push({ level, message, meta, area });
  return { lines, info: log("info"), warn: log("warn"), error: log("error") };
}

async function setup({
  script = {},
  credential = CONNECTED,
  getClientId = () => CLIENT_ID,
  deviceFlow = fakeDeviceFlow(),
  broadcast,
  events = [],
} = {}) {
  const [{ createGithubAuth, EXPIRY_SKEW_MS, OAUTH_LOGIN_GONE }, { createGithubApi }] =
    await Promise.all([loadAuth(), loadApi()]);
  const github = fakeGithubFetch(script);
  const api = createGithubApi({
    fetchImpl: github.fetchImpl,
    sleep: async () => {},
    now: () => NOW,
  });
  const credentials = memoryCredentials(credential, { connectorId: "github" });
  const broadcasts = [];
  const logger = recordingLogger();
  // A function builds the real device flow on this api.
  const flow = typeof deviceFlow === "function" ? deviceFlow(api) : deviceFlow;
  const auth = createGithubAuth({
    api,
    credentials,
    getClientId,
    broadcast:
      broadcast ??
      ((channel, payload) => {
        events.push("broadcast");
        broadcasts.push({ channel, payload });
      }),
    deviceFlow: flow,
    logger,
    now: () => NOW,
  });
  return {
    auth,
    github,
    credentials,
    broadcasts,
    logger,
    deviceFlow: flow,
    EXPIRY_SKEW_MS,
    OAUTH_LOGIN_GONE,
  };
}

const hits = (github, key) => github.calls.filter((call) => `${call.method} ${call.path}` === key);
const slot = (credentials) => credentials.read("acct-1", "github")?.credential ?? null;

test("Connect shows the device code, waits for GitHub, then reads who signed in", async () => {
  const events = [];
  const deviceFlow = fakeDeviceFlow({ events });
  const controller = new AbortController();
  const { auth, github, credentials, broadcasts } = await setup({
    credential: null,
    script: { [USER]: [DANA] },
    deviceFlow,
    events,
  });

  const credential = await auth.authorize({ signal: controller.signal });

  assert.deepEqual(credential, {
    accessToken: "ghu-new",
    refreshToken: "ghr-new",
    expiresAt: NOW + 28800 * 1000,
    refreshExpiresAt: NOW + 15897600 * 1000,
    userId: 42,
    login: "dana",
    needsReconnect: false,
  });
  // The row gets the code before polling starts, and never the device code.
  assert.deepEqual(events, ["start", "broadcast", "poll"]);
  assert.deepEqual(broadcasts, [
    {
      channel: "connector-connect-progress",
      payload: {
        connectorId: "github",
        userCode: "WDJB-MJHT",
        verificationUri: "https://github.com/login/device",
        expiresAt: NOW + 15 * 60 * 1000,
      },
    },
  ]);
  assert.deepEqual(deviceFlow.calls.start, [{ clientId: CLIENT_ID, signal: controller.signal }]);
  assert.deepEqual(deviceFlow.calls.poll, [
    {
      clientId: CLIENT_ID,
      deviceCode: "device-code-1",
      intervalMs: 5000,
      expiresAt: NOW + 15 * 60 * 1000,
      signal: controller.signal,
    },
  ]);
  assert.deepEqual(
    hits(github, USER).map((call) => call.authorization),
    ["Bearer ghu-new"]
  );
  // The manager saves the login; authorize never does.
  assert.equal(slot(credentials), null);
  assert.equal(credentials.saves.length, 0);
});

test("Connect runs end to end on Task 5's device flow, and no request carries a client secret", async () => {
  const { createDeviceFlow } = await import("../../../src/helpers/connectors/githubDeviceFlow.js");
  const { auth, github, broadcasts } = await setup({
    credential: null,
    script: {
      [DEVICE_CODE]: [json(FIXTURES.deviceCode)],
      [TOKEN]: [oauthError("authorization_pending"), json(FIXTURES.token)],
      [USER]: [json(FIXTURES.user)],
    },
    deviceFlow: (api) => createDeviceFlow({ api, sleep: async () => {}, now: () => NOW }),
  });

  const credential = await auth.authorize();

  assert.equal(credential.accessToken, "ghu-1");
  assert.equal(credential.refreshToken, "ghr-1");
  assert.equal(credential.userId, 42);
  assert.equal(credential.login, "dana");
  assert.equal(broadcasts[0].payload.userCode, "WDJB-MJHT");
  assert.deepEqual(github.requests(), [DEVICE_CODE, TOKEN, TOKEN, USER]);
  assert.equal(hits(github, TOKEN)[0].form.client_id, CLIENT_ID);
  for (const call of github.calls) assert.equal(call.form?.client_secret, undefined);
});

test("without a client id, Connect fails before asking GitHub for a code", async () => {
  for (const clientId of [undefined, null, ""]) {
    const { auth, github, broadcasts, deviceFlow } = await setup({
      getClientId: () => clientId,
      credential: null,
    });

    assert.equal(auth.isConfigured(), false, String(clientId));
    await assert.rejects(auth.authorize(), { code: "not_configured" });
    assert.equal(deviceFlow.calls.start.length, 0);
    assert.equal(github.calls.length, 0);
    assert.equal(broadcasts.length, 0);
  }
  const { auth } = await setup();
  assert.equal(auth.isConfigured(), true);
});

test("an expired, declined, disabled or cancelled code ends Connect with its own code", async () => {
  for (const code of ["code_expired", "oauth_denied", "device_flow_disabled", "oauth_cancelled"]) {
    const { auth, github } = await setup({
      credential: null,
      deviceFlow: fakeDeviceFlow({
        poll: async () => {
          throw coded(code);
        },
      }),
    });

    await assert.rejects(auth.authorize(), { code });
    assert.equal(hits(github, USER).length, 0, code);
  }
});

test("a code GitHub refuses to issue ends Connect before any code is shown", async () => {
  const { auth, broadcasts, deviceFlow } = await setup({
    credential: null,
    deviceFlow: fakeDeviceFlow({
      start: async () => {
        throw coded("device_flow_disabled");
      },
    }),
  });

  await assert.rejects(auth.authorize(), { code: "device_flow_disabled" });
  assert.equal(broadcasts.length, 0);
  assert.equal(deviceFlow.calls.poll.length, 0);
});

test("a token without a readable GitHub user is refused as token_exchange_failed", async () => {
  for (const [label, token, user] of [
    ["no access token", { ...ISSUED, access_token: undefined }, DANA],
    ["user 401", ISSUED, json({ message: "Bad credentials" }, 401)],
    ["user without id", ISSUED, json({ login: "dana" })],
    ["user without login", ISSUED, json({ id: 42 })],
  ]) {
    const { auth } = await setup({
      credential: null,
      script: { [USER]: [user] },
      deviceFlow: fakeDeviceFlow({ poll: async () => ({ ok: true, token }) }),
    });

    await assert.rejects(auth.authorize(), { code: "token_exchange_failed" }, label);
  }
});

test("a progress broadcast that throws doesn't stop a sign-in the user completes", async () => {
  const { auth, logger } = await setup({
    credential: null,
    script: { [USER]: [DANA] },
    broadcast: () => {
      throw new Error("window gone");
    },
  });

  assert.equal((await auth.authorize()).login, "dana");
  assert.equal(logger.lines.length, 1);
  assert.equal(logger.lines[0].message, "github connect progress failed");
});

test("a fresh token is used as is, with no request", async () => {
  const { auth, github } = await setup();

  assert.deepEqual(await auth.getAccessToken(BINDING), {
    ok: true,
    token: "ghu-1",
    credential: CONNECTED,
  });
  assert.equal(github.calls.length, 0);
});

test("within 5 minutes of expiry the token is refreshed with the client id only, and the rotated refresh token saved", async () => {
  const { EXPIRY_SKEW_MS } = await loadAuth();
  assert.equal(EXPIRY_SKEW_MS, 5 * 60 * 1000);
  const { auth, github, credentials } = await setup({
    credential: { ...CONNECTED, expiresAt: NOW + EXPIRY_SKEW_MS - 1 },
    script: { [TOKEN]: [REFRESHED] },
  });

  const result = await auth.getAccessToken(BINDING);

  assert.equal(result.ok, true);
  assert.equal(result.token, "ghu-2");
  // Device-flow user tokens refresh without client_secret, so none exists to send.
  assert.deepEqual(
    hits(github, TOKEN).map((call) => call.form),
    [{ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: "ghr-1" }]
  );
  assert.deepEqual(slot(credentials), {
    ...CONNECTED,
    accessToken: "ghu-2",
    refreshToken: "ghr-2",
    expiresAt: NOW + 28800 * 1000,
    refreshExpiresAt: NOW + 15897600 * 1000,
    needsReconnect: false,
  });
  // A refresh keeps the login's generation, so cards bound to it still send.
  assert.equal(credentials.read("acct-1", "github").generation, 1);
});

test("forceRefresh refreshes a fresh token, as a 401 retry needs", async () => {
  const { auth, github } = await setup({ script: { [TOKEN]: [REFRESHED] } });

  assert.equal((await auth.getAccessToken(BINDING, { forceRefresh: true })).token, "ghu-2");
  assert.equal(hits(github, TOKEN).length, 1);
});

test("an expired, revoked or used refresh token means reconnect, asked once and flagged", async () => {
  const { OAUTH_LOGIN_GONE } = await loadAuth();
  assert.deepEqual([...OAUTH_LOGIN_GONE].sort(), [
    "bad_refresh_token",
    "invalid_grant",
    "unauthorized_client",
  ]);
  for (const code of OAUTH_LOGIN_GONE) {
    const { auth, github, credentials } = await setup({
      credential: EXPIRED,
      script: { [TOKEN]: [oauthError(code)] },
    });

    assert.deepEqual(await auth.getAccessToken(BINDING), RECONNECT_NEEDED, code);
    assert.equal(hits(github, TOKEN).length, 1, code);
    assert.equal(slot(credentials).needsReconnect, true, code);
    // Flagged: the next use doesn't ask GitHub again.
    assert.deepEqual(await auth.getAccessToken(BINDING), RECONNECT_NEEDED, code);
    assert.equal(hits(github, TOKEN).length, 1, code);
  }
});

test("a refresh token past its six months, or none at all, means reconnect with no request", async () => {
  for (const credential of [
    { ...EXPIRED, refreshExpiresAt: NOW - 1 },
    { ...EXPIRED, refreshToken: null },
  ]) {
    const { auth, github, credentials } = await setup({ credential });

    assert.deepEqual(await auth.getAccessToken(BINDING), RECONNECT_NEEDED);
    assert.equal(github.calls.length, 0);
    assert.equal(slot(credentials).needsReconnect, true);
  }
});

test("a transient refresh failure is asked once more, and the login is kept either way", async () => {
  const recovered = await setup({
    credential: EXPIRED,
    script: { [TOKEN]: [reset(), REFRESHED] },
  });
  assert.equal((await recovered.auth.getAccessToken(BINDING)).token, "ghu-2");
  assert.equal(hits(recovered.github, TOKEN).length, 2);
  // The retry sent the same refresh token: nothing was rotated in between.
  assert.deepEqual(
    hits(recovered.github, TOKEN).map((call) => call.form.refresh_token),
    ["ghr-1", "ghr-1"]
  );

  for (const failure of [
    reset(),
    json({ message: "Server Error" }, 502),
    oauthError("slow_down"),
  ]) {
    const { auth, github, credentials, logger } = await setup({
      credential: EXPIRED,
      script: { [TOKEN]: [failure] },
    });

    assert.deepEqual(await auth.getAccessToken(BINDING), { ok: false, errorCode: "network" });
    assert.equal(hits(github, TOKEN).length, 2);
    assert.deepEqual(slot(credentials), EXPIRED);
    assert.equal(credentials.saves.length, 0);
    assert.equal(logger.lines.length, 1);
    assert.doesNotMatch(JSON.stringify(logger.lines), /ghr-|ghu-|synthetic/);
  }
});

test("concurrent callers for one login share one refresh", async () => {
  const { auth, github } = await setup({ credential: EXPIRED, script: { [TOKEN]: [REFRESHED] } });

  const [first, second] = await Promise.all([
    auth.getAccessToken(BINDING),
    auth.getAccessToken(BINDING),
  ]);

  assert.equal(first.token, "ghu-2");
  assert.equal(second.token, "ghu-2");
  // Refresh tokens are single-use, so a second request would lose the login.
  assert.equal(hits(github, TOKEN).length, 1);
});

test("a reconnect or disconnect during a refresh wins: nothing is written for the old login", async () => {
  const reconnect = await setup({
    credential: EXPIRED,
    script: {
      [TOKEN]: [
        {
          ...REFRESHED,
          during: () => reconnect.credentials.replace("acct-1", "github", OTHER_LOGIN, 1),
        },
      ],
    },
  });
  assert.deepEqual(await reconnect.auth.getAccessToken(BINDING), CONNECTION_CHANGED);
  assert.deepEqual(slot(reconnect.credentials), OTHER_LOGIN);
  assert.equal(reconnect.credentials.saves.length, 0);

  const disconnect = await setup({
    credential: EXPIRED,
    script: {
      [TOKEN]: [
        { ...REFRESHED, during: () => disconnect.credentials.clear("acct-1", "github", 1) },
      ],
    },
  });
  assert.deepEqual(await disconnect.auth.getAccessToken(BINDING), CONNECTION_CHANGED);
  assert.equal(slot(disconnect.credentials), null);
  assert.equal(disconnect.credentials.saves.length, 0);
});

test("a reconnect during a failing refresh is neither retried nor flagged", async () => {
  for (const failure of [reset(), oauthError("bad_refresh_token")]) {
    const ctx = await setup({
      credential: EXPIRED,
      script: {
        [TOKEN]: [
          { ...failure, during: () => ctx.credentials.replace("acct-1", "github", OTHER_LOGIN, 1) },
        ],
      },
    });

    assert.deepEqual(await ctx.auth.getAccessToken(BINDING), CONNECTION_CHANGED);
    assert.equal(hits(ctx.github, TOKEN).length, 1);
    assert.deepEqual(slot(ctx.credentials), OTHER_LOGIN);
  }
});

test("a binding that no longer matches the stored login never asks GitHub", async () => {
  for (const binding of [
    { ...BINDING, generation: 2 },
    { ...BINDING, accountId: "43" },
    { ...BINDING, ownerAccountId: "acct-2" },
    null,
  ]) {
    const { auth, github } = await setup({ credential: EXPIRED });

    assert.deepEqual(await auth.getAccessToken(binding), CONNECTION_CHANGED);
    assert.equal(github.calls.length, 0);
  }
});

test("a stale token isn't refreshed by a build without a client id, and the login is kept", async () => {
  const { auth, github, credentials } = await setup({
    credential: EXPIRED,
    getClientId: () => undefined,
  });

  assert.deepEqual(await auth.getAccessToken(BINDING), { ok: false, errorCode: "not_configured" });
  assert.equal(github.calls.length, 0);
  assert.deepEqual(slot(credentials), EXPIRED);
});

test("a refreshed token that can't be saved is reported, and the log holds no token", async () => {
  const { auth, credentials, logger } = await setup({
    credential: EXPIRED,
    script: { [TOKEN]: [REFRESHED] },
  });
  credentials.save = () => {
    throw Object.assign(new Error("EACCES ghu-2"), { code: "EACCES" });
  };

  assert.deepEqual(await auth.getAccessToken(BINDING), {
    ok: false,
    errorCode: "credential_save_failed",
  });
  assert.doesNotMatch(JSON.stringify(logger.lines), /ghu-|ghr-/);
});

test("markReconnect flags only the bound login", async () => {
  const bound = await setup();
  assert.deepEqual(bound.auth.markReconnect(BINDING), RECONNECT_NEEDED);
  assert.equal(slot(bound.credentials).needsReconnect, true);

  const replaced = await setup({ credential: OTHER_LOGIN });
  assert.deepEqual(replaced.auth.markReconnect(BINDING), CONNECTION_CHANGED);
  assert.equal(slot(replaced.credentials).needsReconnect, false);
});

test("revoke resolves without a request: GitHub needs the client secret for it", async () => {
  const { auth, github } = await setup();

  assert.equal(await auth.revoke(CONNECTED), undefined);
  assert.equal(github.calls.length, 0);
});

test("the status names the GitHub user and says when a reconnect is needed", async () => {
  const { auth } = await setup();

  assert.deepEqual(auth.statusOf(CONNECTED), {
    connected: true,
    accountLabel: "@dana",
    workspaceLabel: null,
    needsReconnect: false,
  });
  assert.equal(auth.statusOf({ ...CONNECTED, needsReconnect: true }).needsReconnect, true);
  assert.equal(auth.statusOf({ ...CONNECTED, refreshExpiresAt: NOW - 1 }).needsReconnect, true);
  assert.equal(auth.statusOf({ ...CONNECTED, login: undefined }).accountLabel, null);
});

// Connect through the real manager, which saves the login under the account
// and slot generation that started it. The connector here is only the login
// half of Task 8's; Task 8 adds the real one.
const silentLogger = { info() {}, warn() {}, error() {} };

async function setupConnect({ poll, script = { [USER]: [DANA] } } = {}) {
  const [{ createConnectorManager }, { createPendingActions }] = await Promise.all([
    import("../../../src/helpers/connectors/connectorManager.js"),
    import("../../../src/helpers/connectors/pendingActions.js"),
  ]);
  let store = null;
  const deviceFlow = fakeDeviceFlow({ poll: (args) => poll(args, store) });
  const ctx = await setup({ credential: null, script, deviceFlow });
  store = ctx.credentials;
  const { auth, credentials } = ctx;
  const connector = {
    id: "github",
    actions: {},
    async getStatus() {
      const entry = credentials.read(credentials.activeAccountId(), "github");
      return entry
        ? { ...auth.statusOf(entry.credential), configured: true }
        : { connected: false, configured: auth.isConfigured() };
    },
    async getBinding() {
      return null;
    },
    authorize: (options) => auth.authorize(options),
    revoke: () => auth.revoke(),
  };
  const manager = createConnectorManager({
    connectors: [connector],
    pendingActions: createPendingActions(),
    actionLog: {
      insert() {},
      update: () => 1,
      listRecent: () => [],
      reconcileInterrupted: () => ({ unknown: 0, cancelled: 0 }),
    },
    logger: silentLogger,
    getAccountId: () => credentials.activeAccountId(),
    credentials,
  });
  return { manager, ...ctx };
}

const issued = async () => ({ ok: true, token: ISSUED });

test("Connect saves the GitHub login under the account that started it", async () => {
  const { manager, credentials } = await setupConnect({ poll: issued });

  assert.deepEqual(await manager.connect("github", "allowed"), {
    status: "connected",
    accountLabel: "@dana",
    workspaceLabel: null,
  });
  const saved = credentials.read("acct-1", "github");
  assert.equal(saved.generation, 1);
  assert.equal(saved.credential.userId, 42);
  assert.equal(saved.credential.refreshToken, "ghr-new");
});

test("an OpenWhispr account switch while the code waits (up to 15 minutes) saves the login nowhere", async () => {
  const { manager, credentials } = await setupConnect({
    poll: async (args, store) => {
      store.switchAccount("acct-2");
      return issued();
    },
  });

  assert.deepEqual(await manager.connect("github", "allowed"), {
    status: "failed",
    errorCode: "connection_changed",
  });
  assert.equal(credentials.read("acct-1", "github"), null);
  assert.equal(credentials.read("acct-2", "github"), null);
});

test("a login saved while the code waited wins over the late one", async () => {
  const { manager, credentials } = await setupConnect({
    poll: async (args, store) => {
      store.replace("acct-1", "github", OTHER_LOGIN, 0);
      return issued();
    },
  });

  assert.deepEqual(await manager.connect("github", "allowed"), {
    status: "failed",
    errorCode: "connection_changed",
  });
  assert.deepEqual(credentials.read("acct-1", "github").credential, OTHER_LOGIN);
});

test("a newer Connect stops the one still waiting on its code", async () => {
  let polls = 0;
  const { manager, credentials } = await setupConnect({
    poll: ({ signal }) => {
      polls += 1;
      if (polls > 1) return issued();
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(coded("oauth_cancelled")));
      });
    },
  });

  const first = manager.connect("github", "allowed");
  await new Promise((resolve) => setImmediate(resolve));
  const second = await manager.connect("github", "allowed");

  assert.equal(second.status, "connected");
  assert.deepEqual(await first, { status: "failed", errorCode: "oauth_cancelled" });
  assert.equal(credentials.read("acct-1", "github").generation, 1);
});

test("an expired, declined or disabled device code reaches Settings with its own code", async () => {
  for (const code of ["code_expired", "oauth_denied", "device_flow_disabled"]) {
    const { manager, credentials } = await setupConnect({
      poll: async () => {
        throw coded(code);
      },
    });

    assert.deepEqual(await manager.connect("github", "allowed"), {
      status: "failed",
      errorCode: code,
    });
    assert.equal(credentials.read("acct-1", "github"), null);
  }
});
