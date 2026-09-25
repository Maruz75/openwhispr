const { connectorPolicyState, policyRefusal } = require("./connectorPolicy");

const POLICY_TIMEOUT_MS = 1500;
// A name or part of an address; anything longer is not a lookup.
const MAX_CONTACT_QUERY_LENGTH = 200;

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Connectors must tell "signed out" ({}) from "can't tell" (null). Without a
// bearer token only the sender's window can read the cookie session, so a
// window that is already gone must not read as signed out.
function createConnectorAuthLookup({ hasBearerToken, windowFor, authHeaderFor }) {
  return async (event) => {
    if (hasBearerToken()) return authHeaderFor(null);
    const win = windowFor(event);
    if (!win || win.isDestroyed()) return null;
    return authHeaderFor(win);
  };
}

function createConnectorPolicyResolver({
  getAuthHeader,
  getPolicy,
  peekPolicy,
  getAuthGeneration,
  timeoutMs = POLICY_TIMEOUT_MS,
}) {
  // The deadline and the failure handling cover the whole resolution,
  // including the auth-header lookup: nothing here can hang or throw.
  return async (event) => {
    let request = null;
    const resolution = (async () => {
      // Read before the lookup: a sign-in or sign-out during it then fails
      // the policy fetch's generation check instead of passing it.
      const expectedAuthGeneration = getAuthGeneration();
      const authHeaders = await getAuthHeader(event);
      if (!authHeaders || typeof authHeaders !== "object") return "unavailable";
      // Connector logins outlive an OpenWhispr sign-out, so no account means
      // no action (unlike screen context, where signed out is allowed).
      if (!authHeaders.Authorization && !authHeaders.Cookie) return "signed_out";
      // Assigned before the fetch: the deadline's fallback peeks this request.
      request = { expectedAuthGeneration, authHeaders };
      const snapshot = await getPolicy(request);
      return connectorPolicyState(snapshot);
    })().catch(() => "unavailable");

    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    try {
      const state = await Promise.race([resolution, deadline]);
      if (state !== null) return state;
      // A refresh that outlives the deadline must not override the verdict
      // already held for this account; with none held, fail closed.
      try {
        return request && peekPolicy ? connectorPolicyState(peekPolicy(request)) : "unavailable";
      } catch {
        return "unavailable";
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

function registerConnectorIpc({ ipcMain, manager, getPolicyState, findContacts }) {
  // Direct runs still waiting on their policy lookup, by the renderer's run
  // id. A cancel that lands during that wait (Esc) stops the run before it
  // acts; once policy resolves, the action runs without another wait.
  const waitingRuns = new Map();

  ipcMain.handle("connector-status", () => manager.status());

  ipcMain.handle("connector-prepare", async (event, connectorId, action, args) => {
    if (!isNonEmptyString(connectorId) || !isNonEmptyString(action) || !isPlainObject(args)) {
      return { status: "unavailable", reason: "invalid_request" };
    }
    return manager.prepare(connectorId, action, args, await getPolicyState(event));
  });

  ipcMain.handle("connector-commit", async (event, actionId, edits) => {
    if (!isNonEmptyString(actionId)) return { state: "not_sent", reason: "invalid_request" };
    return manager.commit(actionId, isPlainObject(edits) ? edits : {}, await getPolicyState(event));
  });

  ipcMain.handle("connector-cancel", (_event, actionId, reason) => {
    if (!isNonEmptyString(actionId)) return { cancelled: false };
    const waitingRun = waitingRuns.get(actionId);
    if (waitingRun) {
      waitingRun.cancelled = true;
      return { cancelled: true };
    }
    return manager.cancel(actionId, reason);
  });

  ipcMain.handle("connector-run-direct", async (event, connectorId, action, args, runId) => {
    if (!isNonEmptyString(connectorId) || !isNonEmptyString(action) || !isPlainObject(args)) {
      return { state: "unavailable", reason: "invalid_request" };
    }
    const run = { cancelled: false };
    const tracked = isNonEmptyString(runId);
    if (tracked) waitingRuns.set(runId, run);
    const policyState = await getPolicyState(event);
    if (tracked) waitingRuns.delete(runId);
    if (run.cancelled) return { state: "not_sent", reason: "cancelled" };
    return manager.runDirect(connectorId, action, args, policyState, {
      webContents: event.sender,
    });
  });

  ipcMain.handle("connector-recent-actions", (_event, connectorId, limit) => {
    if (!isNonEmptyString(connectorId)) return [];
    return manager.recentActions(connectorId, limit);
  });

  ipcMain.handle("connector-connect", async (event, connectorId) => {
    if (!isNonEmptyString(connectorId)) return { status: "unavailable", reason: "invalid_request" };
    return manager.connect(connectorId, await getPolicyState(event));
  });

  // Removing access is always allowed, so disconnect skips the policy check.
  ipcMain.handle("connector-disconnect", (_event, connectorId) => {
    if (!isNonEmptyString(connectorId)) return { status: "unavailable", reason: "invalid_request" };
    return manager.disconnect(connectorId);
  });

  if (findContacts) {
    // The results go to the model (and its provider), so the org switch
    // applies here too, not just to actions that leave the device.
    ipcMain.handle("connector-find-contacts", async (event, query) => {
      if (typeof query !== "string" || !query.trim() || query.length > MAX_CONTACT_QUERY_LENGTH) {
        return { contacts: [] };
      }
      const refusal = policyRefusal(await getPolicyState(event));
      if (refusal) return { contacts: [], unavailableReason: refusal };
      return findContacts(query.trim());
    });
  }
}

module.exports = { registerConnectorIpc, createConnectorPolicyResolver, createConnectorAuthLookup };
