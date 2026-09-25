const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../../src/helpers/connectors/connectorIpc.js");

function fakeIpcMain() {
  const handlers = new Map();
  return { handlers, handle: (channel, handler) => handlers.set(channel, handler) };
}

function fakeManager() {
  const calls = [];
  const record =
    (name) =>
    (...args) => {
      calls.push({ name, args });
      return { ok: name };
    };
  return {
    calls,
    status: record("status"),
    prepare: record("prepare"),
    commit: record("commit"),
    cancel: record("cancel"),
    runDirect: record("runDirect"),
    recentActions: record("recentActions"),
  };
}

test("connect needs policy; disconnect never does", async () => {
  const { registerConnectorIpc } = await load();
  const ipcMain = fakeIpcMain();
  const calls = [];
  const manager = {
    ...fakeManager(),
    connect: async (...args) => {
      calls.push(["connect", ...args]);
      return { status: "connected", accountLabel: "chad", workspaceLabel: "Acme" };
    },
    disconnect: async (...args) => {
      calls.push(["disconnect", ...args]);
      return { status: "disconnected" };
    },
  };
  let policyCalls = 0;
  registerConnectorIpc({
    ipcMain,
    manager,
    getPolicyState: async () => {
      policyCalls += 1;
      return "allowed";
    },
  });

  await ipcMain.handlers.get("connector-connect")({}, "slack");
  await ipcMain.handlers.get("connector-disconnect")({}, "slack");

  assert.deepEqual(calls, [
    ["connect", "slack", "allowed"],
    ["disconnect", "slack"],
  ]);
  assert.equal(policyCalls, 1);
  assert.deepEqual(await ipcMain.handlers.get("connector-connect")({}, 7), {
    status: "unavailable",
    reason: "invalid_request",
  });
});

test("each channel reaches the manager, with policy only where something can leave", async () => {
  const { registerConnectorIpc } = await load();
  const ipcMain = fakeIpcMain();
  const manager = fakeManager();
  const policyCalls = [];
  registerConnectorIpc({
    ipcMain,
    manager,
    getPolicyState: async (event) => {
      policyCalls.push(event);
      return "allowed";
    },
  });
  const event = { sender: "renderer-1" };
  const h = (channel) => ipcMain.handlers.get(channel);

  await h("connector-status")(event);
  await h("connector-prepare")(event, "slack", "send_message", { text: "hi" });
  await h("connector-commit")(event, "action-1", { body: "hi!" });
  await h("connector-cancel")(event, "action-1", "cancelled_by_user");
  await h("connector-run-direct")(event, "email", "draft", { to: ["a@b.co"] });
  await h("connector-recent-actions")(event, "email", 5);

  assert.deepEqual(
    manager.calls.map((call) => call.name),
    ["status", "prepare", "commit", "cancel", "runDirect", "recentActions"]
  );
  assert.deepEqual(manager.calls[1].args, ["slack", "send_message", { text: "hi" }, "allowed"]);
  assert.deepEqual(manager.calls[2].args, ["action-1", { body: "hi!" }, "allowed"]);
  assert.deepEqual(manager.calls[4].args, [
    "email",
    "draft",
    { to: ["a@b.co"] },
    "allowed",
    { webContents: "renderer-1" },
  ]);
  assert.equal(policyCalls.length, 3);
});

test("a cancel that lands while a direct run waits on policy stops it", async () => {
  const { registerConnectorIpc } = await load();
  const ipcMain = fakeIpcMain();
  const manager = fakeManager();
  const policyWaits = [];
  registerConnectorIpc({
    ipcMain,
    manager,
    getPolicyState: () => new Promise((resolve) => policyWaits.push(resolve)),
  });
  const h = (channel) => ipcMain.handlers.get(channel);

  const cancelledRun = h("connector-run-direct")({}, "email", "draft", { to: ["a@b.co"] }, "run-1");
  assert.deepEqual(await h("connector-cancel")({}, "run-1", "cancelled_by_user"), {
    cancelled: true,
  });
  policyWaits.shift()("allowed");
  assert.deepEqual(await cancelledRun, { state: "not_sent", reason: "cancelled" });

  // Once policy resolves the run is no longer tracked, so a later cancel with
  // the same id is an ordinary (pending approval) cancel.
  const run = h("connector-run-direct")({}, "email", "draft", { to: ["a@b.co"] }, "run-2");
  policyWaits.shift()("allowed");
  await run;
  await h("connector-cancel")({}, "run-2", "cancelled_by_user");

  assert.deepEqual(
    manager.calls.map((call) => call.name),
    ["runDirect", "cancel"]
  );
});

test("malformed arguments never reach the manager", async () => {
  const { registerConnectorIpc } = await load();
  const ipcMain = fakeIpcMain();
  const manager = fakeManager();
  registerConnectorIpc({ ipcMain, manager, getPolicyState: async () => "allowed" });

  const prepared = await ipcMain.handlers.get("connector-prepare")({}, 42, "send_message", null);
  const committed = await ipcMain.handlers.get("connector-commit")({}, null, {});

  assert.deepEqual(prepared, { status: "unavailable", reason: "invalid_request" });
  assert.deepEqual(committed, { state: "not_sent", reason: "invalid_request" });
  assert.equal(manager.calls.length, 0);
});

test("signed out refuses, a lookup that can't tell fails closed, snapshots still map", async () => {
  const { createConnectorPolicyResolver } = await load();
  const neverCalled = async () => {
    throw new Error("must not be called");
  };

  const signedOut = createConnectorPolicyResolver({
    getAuthHeader: async () => ({}),
    getPolicy: neverCalled,
    getAuthGeneration: () => 1,
  });
  assert.equal(await signedOut({}), "signed_out");

  const cannotTell = createConnectorPolicyResolver({
    getAuthHeader: async () => null,
    getPolicy: neverCalled,
    getAuthGeneration: () => 1,
  });
  assert.equal(await cannotTell({}), "unavailable");

  const blocked = createConnectorPolicyResolver({
    getAuthHeader: async () => ({ Authorization: "Bearer t" }),
    getPolicy: async () => ({
      success: true,
      managed: true,
      policy: { features: { agentEnabled: true, connectorsEnabled: false } },
    }),
    getAuthGeneration: () => 1,
  });
  assert.equal(await blocked({}), "blocked");
});

test("the auth generation is read before the header lookup", async () => {
  const { createConnectorPolicyResolver } = await load();
  let generation = 1;
  const expected = [];
  const resolver = createConnectorPolicyResolver({
    // A sign-in lands while the header lookup is running.
    getAuthHeader: async () => {
      generation = 2;
      return { Authorization: "Bearer new-session" };
    },
    getPolicy: async ({ expectedAuthGeneration }) => {
      expected.push(expectedAuthGeneration);
      return { success: false, status: "error", code: "AUTH_CONTEXT_CHANGED" };
    },
    getAuthGeneration: () => generation,
  });

  assert.equal(await resolver({}), "unavailable");
  assert.deepEqual(expected, [1]);
});

test("a slow refresh still falls back to the cached verdict for the same request", async () => {
  const { createConnectorPolicyResolver } = await load();
  let generation = 4;
  const peeked = [];
  const resolver = createConnectorPolicyResolver({
    getAuthHeader: async () => {
      generation = 5;
      return { Authorization: "Bearer t" };
    },
    getPolicy: () => new Promise(() => {}),
    peekPolicy: (request) => {
      peeked.push(request.expectedAuthGeneration);
      return { success: true, managed: false, policy: null };
    },
    getAuthGeneration: () => generation,
    timeoutMs: 20,
  });

  assert.equal(await resolver({}), "allowed");
  assert.deepEqual(peeked, [4]);
});

test("the auth lookup never reads a destroyed window as signed out", async () => {
  const { createConnectorAuthLookup } = await load();
  const live = { isDestroyed: () => false };
  const gone = { isDestroyed: () => true };
  const lookup = (hasToken, win) =>
    createConnectorAuthLookup({
      hasBearerToken: () => hasToken,
      windowFor: () => win,
      authHeaderFor: async (w) => {
        if (hasToken) return { Authorization: "Bearer t" };
        return w === live ? {} : { Cookie: "session=1" };
      },
    });

  assert.deepEqual(await lookup(true, null)({}), { Authorization: "Bearer t" });
  assert.equal(await lookup(false, null)({}), null);
  assert.equal(await lookup(false, gone)({}), null);
  assert.deepEqual(await lookup(false, live)({}), {});
});

test("a policy lookup that hangs or throws fails closed", async () => {
  const { createConnectorPolicyResolver } = await load();
  const hanging = createConnectorPolicyResolver({
    getAuthHeader: async () => ({ Authorization: "Bearer t" }),
    getPolicy: () => new Promise(() => {}),
    getAuthGeneration: () => 1,
    timeoutMs: 20,
  });
  const started = Date.now();
  assert.equal(await hanging({}), "unavailable");
  assert.ok(Date.now() - started < 1000);

  const throwing = createConnectorPolicyResolver({
    getAuthHeader: async () => ({ Cookie: "session=1" }),
    getPolicy: async () => {
      throw new Error("offline");
    },
    getAuthGeneration: () => 1,
  });
  assert.equal(await throwing({}), "unavailable");

  const throttled = createConnectorPolicyResolver({
    getAuthHeader: async () => ({ Authorization: "Bearer t" }),
    getPolicy: async () => ({ success: false, status: "error", code: "POLICY_RETRY_THROTTLED" }),
    getAuthGeneration: () => 1,
  });
  assert.equal(await throttled({}), "unavailable");
});

test("a slow refresh falls back to the verdict already held for the account", async () => {
  const { createConnectorPolicyResolver } = await load();
  const peeked = [];
  const slowRefresh = (held) =>
    createConnectorPolicyResolver({
      getAuthHeader: async () => ({ Authorization: "Bearer t" }),
      getPolicy: () => new Promise(() => {}),
      peekPolicy: (request) => {
        peeked.push(request);
        return held;
      },
      getAuthGeneration: () => 7,
      timeoutMs: 20,
    });

  assert.equal(await slowRefresh({ success: true, managed: false, policy: null })({}), "allowed");
  assert.equal(
    await slowRefresh({
      success: true,
      managed: true,
      policy: { features: { connectorsEnabled: false } },
    })({}),
    "blocked"
  );
  // Nothing held yet (the session's first lookup): still fails closed.
  assert.equal(await slowRefresh(null)({}), "unavailable");
  assert.deepEqual(peeked[0], {
    expectedAuthGeneration: 7,
    authHeaders: { Authorization: "Bearer t" },
  });
});

test("the auth generation is read before the header lookup", async () => {
  const { createConnectorPolicyResolver } = await load();
  let generation = 4;
  const requests = [];
  const resolver = createConnectorPolicyResolver({
    getAuthHeader: async () => {
      // A sign-in lands while the cookie lookup is in flight.
      generation = 5;
      return { Cookie: "session=old" };
    },
    getPolicy: async (request) => {
      requests.push(request);
      return { success: false, status: "error", code: "AUTH_CONTEXT_CHANGED" };
    },
    getAuthGeneration: () => generation,
  });

  assert.equal(await resolver({}), "unavailable");
  assert.equal(requests[0].expectedAuthGeneration, 4);
});

test("the deadline covers the auth-header lookup too", async () => {
  const { createConnectorPolicyResolver } = await load();
  const hangingAuth = createConnectorPolicyResolver({
    getAuthHeader: () => new Promise(() => {}),
    getPolicy: async () => {
      throw new Error("must not be called");
    },
    getAuthGeneration: () => 1,
    timeoutMs: 20,
  });
  const started = Date.now();
  assert.equal(await hangingAuth({}), "unavailable");
  assert.ok(Date.now() - started < 1000);

  const throwingAuth = createConnectorPolicyResolver({
    getAuthHeader: async () => {
      throw new Error("window destroyed");
    },
    getPolicy: async () => ({ success: true, managed: false, policy: null }),
    getAuthGeneration: () => {
      throw new Error("token store unavailable");
    },
  });
  assert.equal(await throwingAuth({}), "unavailable");
});

test("contact lookup trims the query and returns nothing the org policy doesn't allow", async () => {
  const { registerConnectorIpc } = await load();
  const ipcMain = fakeIpcMain();
  const queries = [];
  const policies = ["allowed", "blocked", "unavailable"];
  registerConnectorIpc({
    ipcMain,
    manager: fakeManager(),
    getPolicyState: async () => policies.shift(),
    findContacts: (query) => {
      queries.push(query);
      return {
        contacts: [{ name: "Gabe", email: "gabe@example.com", lastMet: null }],
        hasMore: false,
      };
    },
  });
  const handler = ipcMain.handlers.get("connector-find-contacts");
  assert.deepEqual(await handler({}, "  Gabe "), {
    contacts: [{ name: "Gabe", email: "gabe@example.com", lastMet: null }],
    hasMore: false,
  });
  assert.deepEqual(await handler({}, "Gabe"), {
    contacts: [],
    unavailableReason: "policy_blocked",
  });
  assert.deepEqual(await handler({}, "Gabe"), {
    contacts: [],
    unavailableReason: "policy_unavailable",
  });
  // Malformed or oversized queries never reach the policy lookup or the search.
  assert.deepEqual(await handler({}, 42), { contacts: [] });
  assert.deepEqual(await handler({}, "a".repeat(201)), { contacts: [] });
  assert.deepEqual(queries, ["Gabe"]);
  assert.equal(policies.length, 0);
});
