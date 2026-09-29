const test = require("node:test");
const assert = require("node:assert/strict");
const { CONNECTED, fakeGithubFetch, json, memoryCredentials } = require("./githubFixtures");

const INSTALLATIONS = "GET /user/installations";
const REPOSITORIES = "GET /user/installations/7/repositories";
const CREATE = "POST /repos/acme/api/issues";
const ALLOWED = { policyState: "allowed", accountId: "acct-1" };
const INSTALL_URL = "https://github.com/apps/openwhispr-dev/installations/new";
const ENV = { GITHUB_APP_CLIENT_ID: "Iv1.test-client", GITHUB_APP_SLUG: "openwhispr-dev" };
const silentLogger = { info() {}, warn() {}, error() {} };
const INSTALLED = {
  [INSTALLATIONS]: [json({ total_count: 1, installations: [{ id: 7 }] })],
  [REPOSITORIES]: [
    json({
      total_count: 1,
      repositories: [
        {
          name: "api",
          full_name: "acme/api",
          owner: { login: "acme" },
          private: true,
          updated_at: "2026-09-27T10:00:00Z",
        },
      ],
    }),
  ],
};
const CREATED = json({ number: 212, html_url: "https://github.com/acme/api/issues/212" }, 201);
const ISSUE = { repo: "acme/api", title: "Login times out", body: "After 30 s." };
const OTHER_LOGIN = { ...CONNECTED, userId: 43, login: "sam", accessToken: "ghu-other" };

// The receipts table, in memory: a guarded update only moves a row still in
// fromState, like updateConnectorActionState.
function fakeLog() {
  const rows = new Map();
  return {
    rows,
    insert: (row) => rows.set(row.id, { ...row }),
    update: (id, patch, fromState) => {
      const row = rows.get(id);
      if (!row || (fromState !== undefined && row.state !== fromState)) return 0;
      rows.set(id, { ...row, ...patch });
      return 1;
    },
    listRecent: () => [],
    reconcileInterrupted: () => ({ unknown: 0, cancelled: 0 }),
  };
}

// The connector exactly as main builds it (buildGithubConnector), driven
// through the real manager.
async function setup({ script = {}, credential = CONNECTED, env = ENV } = {}) {
  const [{ createConnectorManager }, { createPendingActions }, { buildGithubConnector }] =
    await Promise.all([
      import("../../../src/helpers/connectors/connectorManager.js"),
      import("../../../src/helpers/connectors/pendingActions.js"),
      import("../../../src/helpers/connectors/githubConnector.js"),
    ]);
  const github = fakeGithubFetch({ ...INSTALLED, ...script });
  const credentials = memoryCredentials(credential, { connectorId: "github" });
  const broadcasts = [];
  const connector = buildGithubConnector({
    fetch: github.fetchImpl,
    credentials,
    env,
    broadcast: (channel, payload) => broadcasts.push({ channel, payload }),
    logger: silentLogger,
  });
  const log = fakeLog();
  const manager = createConnectorManager({
    connectors: [connector],
    pendingActions: createPendingActions(),
    actionLog: log,
    logger: silentLogger,
    getAccountId: () => credentials.activeAccountId(),
    credentials,
  });
  return { manager, connector, github, credentials, log, broadcasts };
}

const hits = (github, key) => github.calls.filter((call) => `${call.method} ${call.path}` === key);

test("buildGithubConnector reads the client id and App slug from the environment when asked", async () => {
  const env = {};
  const { connector, manager } = await setup({ credential: null, env });

  assert.equal(connector.id, "github");
  assert.equal((await connector.getStatus()).configured, false);
  // process.env is read lazily, so a value set after startup still counts.
  Object.assign(env, ENV);
  const [status] = await manager.status();
  assert.equal(status.configured, true);
  assert.equal(status.manageUrl, INSTALL_URL);
});

test("the status through the manager keeps the repository count and the GitHub manage link", async () => {
  const { manager, github } = await setup();

  assert.deepEqual(await manager.status(), [
    {
      id: "github",
      connected: true,
      configured: true,
      accountLabel: "@dana",
      workspaceLabel: "1",
      needsReconnect: false,
      manageUrl: INSTALL_URL,
    },
  ]);
  // Every request went through the fetch main passes in, with GitHub's headers.
  assert.equal(hits(github, INSTALLATIONS)[0].authorization, "Bearer ghu-1");
});

test("Send creates exactly the card's edited issue, and the receipt holds the repo only", async () => {
  const { manager, github, log } = await setup({ script: { [CREATE]: [CREATED] } });

  const prepared = await manager.prepare("github", "create_issue", ISSUE, ALLOWED);
  assert.equal(prepared.status, "ready");
  const sent = await manager.commit(
    prepared.actionId,
    { title: "Login times out after 30 s", body: "Edited.", labels: ["smuggled"] },
    ALLOWED
  );

  assert.equal(sent.state, "sent");
  assert.equal(sent.url, "https://github.com/acme/api/issues/212");
  assert.deepEqual(hits(github, CREATE)[0].json, {
    title: "Login times out after 30 s",
    body: "Edited.",
  });
  const [row] = log.rows.values();
  assert.equal(row.destinationLabel, "acme/api");
  assert.doesNotMatch(JSON.stringify([...log.rows.values()]), /Login times out|Edited/);
});

test("a title edited to two lines is refused before anything reaches GitHub", async () => {
  const { manager, github } = await setup({ script: { [CREATE]: [CREATED] } });
  const prepared = await manager.prepare("github", "create_issue", ISSUE, ALLOWED);

  assert.deepEqual(await manager.commit(prepared.actionId, { title: "Two\nlines" }, ALLOWED), {
    state: "not_sent",
    reason: "invalid_edit",
  });
  assert.equal(hits(github, CREATE).length, 0);
});

test("a card never sends after an OpenWhispr account switch or a GitHub reconnect", async () => {
  const switched = await setup({ script: { [CREATE]: [CREATED] } });
  const first = await switched.manager.prepare("github", "create_issue", ISSUE, ALLOWED);
  switched.credentials.switchAccount("acct-2");
  const refused = await switched.manager.commit(
    first.actionId,
    {},
    { ...ALLOWED, accountId: "acct-2" }
  );
  assert.deepEqual(refused, { state: "not_sent", reason: "account_changed" });
  assert.equal(hits(switched.github, CREATE).length, 0);

  const reconnected = await setup({ script: { [CREATE]: [CREATED] } });
  const second = await reconnected.manager.prepare("github", "create_issue", ISSUE, ALLOWED);
  reconnected.credentials.replace("acct-1", "github", OTHER_LOGIN, 1);
  assert.deepEqual(await reconnected.manager.commit(second.actionId, {}, ALLOWED), {
    state: "not_sent",
    reason: "connection_changed",
  });
  assert.equal(hits(reconnected.github, CREATE).length, 0);
});

test("createConnectors registers GitHub once, built from the shared deps", async () => {
  const { createConnectors } = await import("../../../src/helpers/connectors/createConnectors.js");
  const github = fakeGithubFetch(INSTALLED);
  const deps = {
    fetch: github.fetchImpl,
    i18n: { t: (key) => key },
    runOAuthLoopbackFlow: async () => {
      throw new Error("not used in this test");
    },
    OAuthFlowError: Error,
    renderOAuthResultPage: () => "",
    credentials: memoryCredentials(CONNECTED, { connectorId: "github" }),
    logger: silentLogger,
    env: ENV,
    openExternal: () => {},
    writeClipboard: () => {},
    getGoogleCalendarAccounts: () => [],
    broadcast: () => {},
  };

  const connectors = createConnectors(deps);

  const githubConnectors = connectors.filter((connector) => connector.id === "github");
  assert.equal(githubConnectors.length, 1);
  assert.deepEqual(Object.keys(githubConnectors[0].actions), [
    "search_issues",
    "create_issue",
    "comment",
  ]);
  const status = await githubConnectors[0].getStatus();
  assert.equal(status.workspaceLabel, "1");
  assert.equal(status.manageUrl, INSTALL_URL);
  assert.ok(github.calls.length > 0);
});
