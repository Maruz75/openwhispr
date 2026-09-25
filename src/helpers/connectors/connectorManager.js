const crypto = require("crypto");
const { describeError } = require("./errorSummary");
const { policyRefusal } = require("./connectorPolicy");

const CANCEL_REASONS = new Set(["cancelled_by_user", "conversation_ended", "expired"]);
const COMMIT_RESULT_STATES = new Set(["sent", "failed", "unknown"]);
const DIRECT_RESULT_STATES = new Set(["sent", "failed", "unknown"]);

// A connector is third-party code (or a stub in tests); never trust its
// result shape before it gets written to the receipt or handed back. An
// undefined result would otherwise throw reading `.state`, orphaning the
// pending entry in "committing" forever.
function normalizeCommitResult(result) {
  if (result && typeof result === "object" && COMMIT_RESULT_STATES.has(result.state)) return result;
  return { state: "unknown" };
}

// A direct action that threw or answered malformed may already have acted
// (a compose window opened before a later step failed); calling it "failed"
// would invite a duplicate retry.
function uncertainDirectResult(errorCode) {
  return {
    state: "unknown",
    errorCode,
    message: "That action may have gone through. Ask the user to check before trying again.",
  };
}

function normalizeDirectResult(result) {
  if (result && typeof result === "object" && DIRECT_RESULT_STATES.has(result.state)) return result;
  return uncertainDirectResult("invalid_result");
}

const INVALID_PREPARE_RESULT = {
  status: "failed",
  errorCode: "invalid_result",
  message: "Couldn't prepare that action.",
};

// Actions that write a receipt need the account the receipt belongs to.
function actionRefusal(policyState, accountId) {
  return policyRefusal(policyState) ?? (accountId ? null : "signed_out");
}

function isString(value) {
  return typeof value === "string";
}

function isPreview(preview) {
  return (
    Boolean(preview) &&
    typeof preview === "object" &&
    isString(preview.verbKey) &&
    isString(preview.destinationLabel) &&
    isString(preview.accountLabel) &&
    isString(preview.body) &&
    (preview.title === undefined || isString(preview.title)) &&
    (preview.workspaceLabel === undefined || isString(preview.workspaceLabel))
  );
}

// A connector's prepare result decides whether a card appears and what it
// shows, so it is checked like a commit result: anything malformed fails
// closed, with no card and no receipt. Only the fields each status defines
// reach the renderer, so a connector can't leak anything else (such as
// message text) through an odd result.
function normalizePrepareResult(result) {
  if (result && typeof result === "object") {
    if (result.status === "ready" && isPreview(result.preview) && result.payload !== undefined) {
      return { status: "ready", payload: result.payload, preview: result.preview };
    }
    if (result.status === "needs_clarification" && isString(result.message)) {
      return {
        status: "needs_clarification",
        message: result.message,
        candidates: Array.isArray(result.candidates) ? result.candidates.filter(isString) : [],
      };
    }
    if (result.status === "failed" && isString(result.errorCode) && isString(result.message)) {
      return { status: "failed", errorCode: result.errorCode, message: result.message };
    }
  }
  return INVALID_PREPARE_RESULT;
}

function normalizeStatus(status) {
  const value = status && typeof status === "object" ? status : {};
  return {
    connected: value.connected === true,
    accountLabel: isString(value.accountLabel) ? value.accountLabel : null,
    workspaceLabel: isString(value.workspaceLabel) ? value.workspaceLabel : null,
    needsReconnect: value.needsReconnect === true,
  };
}

// A binding that can't be compared counts as no connection.
function normalizeBinding(binding) {
  if (!binding || typeof binding !== "object") return null;
  if (!isString(binding.accountId) || !Number.isInteger(binding.generation)) return null;
  return binding;
}

function sanitizeEdits(edits) {
  const clean = {};
  if (edits && typeof edits.title === "string") clean.title = edits.title;
  if (edits && typeof edits.body === "string") clean.body = edits.body;
  return clean;
}

const REVOKE_TIMEOUT_MS = 5000;
const CONNECT_ERROR_CODES = new Set([
  "not_configured",
  "oauth_denied",
  "oauth_timeout",
  "oauth_state_mismatch",
  "ports_busy",
  "token_exchange_failed",
]);

// A revoke is best effort: nothing may hang on an unreachable provider.
async function withinDeadline(promise, ms) {
  let timer;
  try {
    await Promise.race([promise, new Promise((resolve) => (timer = setTimeout(resolve, ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

function createConnectorManager({
  connectors,
  pendingActions,
  actionLog,
  logger,
  getAccountId,
  credentials = null,
  onStatusChanged = () => {},
  randomId = () => crypto.randomBytes(16).toString("hex"),
}) {
  const byId = new Map(connectors.map((connector) => [connector.id, connector]));

  // Writes before a side effect gate it: without a durable row, a crash
  // mid-send could hide a message that was actually sent.
  function writeRequired(step, write) {
    try {
      return write() !== false;
    } catch (error) {
      logger.error(
        "connector receipt write failed",
        { step, ...describeError(error) },
        "connectors"
      );
      return false;
    }
  }

  // Writes after the outcome is known are best effort: a failure leaves the
  // row in its last durable state, which reconciliation treats conservatively.
  function record(write) {
    try {
      write();
    } catch (error) {
      logger.warn("connector receipt update failed", { ...describeError(error) }, "connectors");
    }
  }

  record(() => {
    const reconciled = actionLog.reconcileInterrupted();
    if (reconciled.unknown || reconciled.cancelled) {
      logger.info("reconciled interrupted connector actions", reconciled, "connectors");
    }
  });

  function resolveAction(connectorId, action, kind) {
    const connector = byId.get(connectorId);
    if (!connector) return { error: "unknown_connector" };
    if (connector.actions[action]?.kind !== kind) return { error: "unknown_action" };
    return { connector };
  }

  // Cards the renderer never answered are expired here too, so their payload
  // (message text) doesn't linger and Recent never shows them as waiting.
  // Their receipts say so rather than a later "app_quit".
  function sweepExpired() {
    for (const actionId of pendingActions.sweepExpired()) {
      record(() =>
        actionLog.update(actionId, { state: "expired", errorCode: "expired" }, "pending")
      );
    }
  }

  async function statusOf(connector) {
    try {
      return { id: connector.id, ...normalizeStatus(await connector.getStatus()) };
    } catch (error) {
      logger.warn(
        "connector status failed",
        { connectorId: connector.id, ...describeError(error) },
        "connectors"
      );
      return { id: connector.id, ...normalizeStatus(null) };
    }
  }

  async function currentBinding(connector) {
    try {
      return normalizeBinding(await connector.getBinding());
    } catch (error) {
      logger.warn(
        "connector binding failed",
        { connectorId: connector.id, ...describeError(error) },
        "connectors"
      );
      return null;
    }
  }

  async function status() {
    sweepExpired();
    return Promise.all([...byId.values()].map(statusOf));
  }

  const connecting = new Set();
  let statusSequence = 0;

  async function notifyStatusChanged() {
    const sequence = ++statusSequence;
    try {
      const statuses = await status();
      // A later change is already being announced; this snapshot is older.
      if (sequence === statusSequence) onStatusChanged(statuses);
    } catch (error) {
      logger.warn("connector status broadcast failed", describeError(error), "connectors");
    }
  }

  async function revokeQuietly(connector, credential) {
    try {
      await withinDeadline(connector.revoke(credential), REVOKE_TIMEOUT_MS);
    } catch (error) {
      logger.warn(
        "connector revoke failed",
        { connectorId: connector.id, ...describeError(error) },
        "connectors"
      );
    }
  }

  async function connect(connectorId, policyState) {
    const accountId = getAccountId();
    const refusal = actionRefusal(policyState, accountId);
    if (refusal) return { status: "unavailable", reason: refusal };
    const connector = byId.get(connectorId);
    if (!connector?.authorize || !credentials) {
      return { status: "unavailable", reason: "unknown_connector" };
    }
    const flowKey = `${accountId}:${connectorId}`;
    if (connecting.has(flowKey)) return { status: "failed", errorCode: "busy" };
    connecting.add(flowKey);
    // The OAuth round trip can take minutes. What it returns belongs to the
    // account and slot generation that started it, or to no one.
    const startGeneration = credentials.generation(accountId, connectorId);
    try {
      let credential;
      try {
        credential = await connector.authorize();
      } catch (error) {
        const summary = describeError(error);
        logger.warn("connector connect failed", { connectorId, ...summary }, "connectors");
        return {
          status: "failed",
          errorCode: CONNECT_ERROR_CODES.has(summary.errorCode)
            ? summary.errorCode
            : "connect_failed",
        };
      }
      try {
        if (getAccountId() !== accountId) {
          throw Object.assign(new Error("account changed"), { code: "connection_changed" });
        }
        // A new login: approvals prepared under the old one must not send.
        credentials.replace(accountId, connectorId, credential, startGeneration);
      } catch {
        // Nobody will use this login, so it is revoked rather than left live.
        await revokeQuietly(connector, credential);
        return { status: "failed", errorCode: "connection_changed" };
      }
      invalidate(connectorId);
      await notifyStatusChanged();
      const current = await statusOf(connector);
      return {
        status: "connected",
        accountLabel: current.accountLabel,
        workspaceLabel: current.workspaceLabel,
      };
    } finally {
      connecting.delete(flowKey);
    }
  }

  // Removing access is always allowed: no policy or plan check.
  async function disconnect(connectorId) {
    const connector = byId.get(connectorId);
    if (!connector?.revoke || !credentials) {
      return { status: "unavailable", reason: "unknown_connector" };
    }
    const accountId = getAccountId();
    if (!accountId) return { status: "unavailable", reason: "signed_out" };
    const entry = credentials.read(accountId, connectorId);
    if (entry) {
      await revokeQuietly(connector, entry.credential);
      try {
        credentials.clear(accountId, connectorId, entry.generation);
      } catch {
        // A reconnect landed while revoking: that newer login stays.
        return { status: "failed", errorCode: "connection_changed" };
      }
    }
    invalidate(connectorId);
    await notifyStatusChanged();
    return { status: "disconnected" };
  }

  async function disconnectAll() {
    for (const connector of byId.values()) {
      if (connector.revoke) await disconnect(connector.id);
    }
  }

  async function prepare(connectorId, action, args, policyState) {
    sweepExpired();
    const accountId = getAccountId();
    const refusal = actionRefusal(policyState, accountId);
    if (refusal) return { status: "unavailable", reason: refusal };
    const resolved = resolveAction(connectorId, action, "approval");
    if (resolved.error) return { status: "unavailable", reason: resolved.error };
    const { connector } = resolved;

    const binding = await currentBinding(connector);
    if (!binding) return { status: "unavailable", reason: "not_connected" };

    let prepared;
    try {
      prepared = normalizePrepareResult(await connector.prepare(action, args || {}, { binding }));
    } catch (error) {
      logger.warn(
        "connector prepare threw",
        { connectorId, action, ...describeError(error) },
        "connectors"
      );
      return { ...INVALID_PREPARE_RESULT, errorCode: "prepare_failed" };
    }
    if (prepared.errorCode === "reconnect_needed") void notifyStatusChanged();
    if (prepared.status !== "ready") return prepared;

    const actionId = pendingActions.create({
      connectorId,
      action,
      binding,
      payload: prepared.payload,
      preview: prepared.preview,
    });
    const recorded = writeRequired("pending", () => {
      actionLog.insert({
        id: actionId,
        accountId,
        connector: connectorId,
        action,
        kind: "approval",
        destinationLabel: prepared.preview.destinationLabel,
        state: "pending",
      });
    });
    if (!recorded) {
      pendingActions.cancel(actionId);
      return {
        status: "failed",
        errorCode: "receipt_unavailable",
        message: "Couldn't record this action, so nothing was prepared.",
      };
    }
    return { status: "ready", actionId, preview: prepared.preview };
  }

  async function commit(actionId, edits, policyState) {
    sweepExpired();
    const entry = pendingActions.get(actionId);
    if (!entry) return { state: "not_sent", reason: "not_found" };
    // A second click while the first is sending must neither send nor
    // overwrite the in-flight row.
    if (entry.state !== "pending") return { state: "not_sent", reason: "not_pending" };

    const refusal = policyRefusal(policyState);
    // A policy lookup that timed out or went offline says nothing about this
    // action: leave it pending so the user can press Send again.
    if (refusal === "policy_unavailable") {
      return { state: "not_sent", reason: refusal, retryable: true };
    }
    if (refusal) {
      pendingActions.cancel(actionId);
      record(() =>
        actionLog.update(actionId, { state: "cancelled", errorCode: refusal }, "pending")
      );
      return { state: "not_sent", reason: refusal };
    }

    const connector = byId.get(entry.connectorId);
    const begun = pendingActions.beginCommit(actionId, await currentBinding(connector));
    if (!begun.ok) {
      if (begun.reason === "expired" || begun.reason === "connection_changed") {
        const state = begun.reason === "expired" ? "expired" : "cancelled";
        record(() => actionLog.update(actionId, { state, errorCode: begun.reason }, "pending"));
      }
      return { state: "not_sent", reason: begun.reason };
    }

    const recorded = writeRequired(
      "committing",
      () => actionLog.update(actionId, { state: "committing" }, "pending") === 1
    );
    if (!recorded) {
      pendingActions.finish(actionId);
      record(() =>
        actionLog.update(
          actionId,
          { state: "cancelled", errorCode: "receipt_unavailable" },
          "pending"
        )
      );
      return { state: "not_sent", reason: "receipt_unavailable" };
    }

    let result;
    try {
      result = await connector.commit(entry.action, entry.payload, sanitizeEdits(edits), {
        binding: entry.binding,
      });
    } catch (error) {
      logger.warn(
        "connector commit threw",
        { connectorId: entry.connectorId, action: entry.action, ...describeError(error) },
        "connectors"
      );
      result = { state: "unknown" };
    }
    result = normalizeCommitResult(result);
    if (result.errorCode === "reconnect_needed") void notifyStatusChanged();

    pendingActions.finish(actionId);
    record(() =>
      actionLog.update(actionId, {
        state: result.state,
        resultUrl: result.url || result.checkUrl || null,
        errorCode: result.errorCode || null,
      })
    );
    logger.info(
      "connector action finished",
      { connectorId: entry.connectorId, action: entry.action, state: result.state },
      "connectors"
    );
    return result;
  }

  function cancel(actionId, reason) {
    sweepExpired();
    const safeReason = CANCEL_REASONS.has(reason) ? reason : "cancelled_by_user";
    const cancelled = pendingActions.cancel(actionId);
    if (cancelled) {
      const state = safeReason === "expired" ? "expired" : "cancelled";
      record(() => actionLog.update(actionId, { state, errorCode: safeReason }));
    }
    return { cancelled };
  }

  async function runDirect(connectorId, action, args, policyState, runtime) {
    const accountId = getAccountId();
    const refusal = actionRefusal(policyState, accountId);
    if (refusal) return { state: "unavailable", reason: refusal };
    const resolved = resolveAction(connectorId, action, "direct");
    if (resolved.error) return { state: "unavailable", reason: resolved.error };

    const id = randomId();
    const recorded = writeRequired("direct", () => {
      actionLog.insert({
        id,
        accountId,
        connector: connectorId,
        action,
        kind: "direct",
        state: "committing",
      });
    });
    if (!recorded) return { state: "unavailable", reason: "receipt_unavailable" };

    let result;
    try {
      result = normalizeDirectResult(
        await resolved.connector.runDirect(action, args || {}, runtime || {})
      );
    } catch (error) {
      logger.warn(
        "connector direct action threw",
        { connectorId, action, ...describeError(error) },
        "connectors"
      );
      result = uncertainDirectResult("direct_failed");
    }
    record(() =>
      actionLog.update(id, {
        state: result.state,
        destinationLabel: result.destinationLabel || null,
        errorCode: result.errorCode || null,
      })
    );
    return result;
  }

  function invalidate(connectorId) {
    const removed = pendingActions.invalidateConnector(connectorId);
    for (const actionId of removed) {
      record(() =>
        actionLog.update(actionId, { state: "cancelled", errorCode: "connection_changed" })
      );
    }
    return removed;
  }

  function recentActions(connectorId, limit) {
    sweepExpired();
    const accountId = getAccountId();
    if (!accountId) return [];
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;
    return actionLog.listRecent(connectorId, safeLimit, accountId);
  }

  return {
    status,
    prepare,
    commit,
    cancel,
    runDirect,
    invalidate,
    recentActions,
    sweepExpired,
    connect,
    disconnect,
    disconnectAll,
    notifyStatusChanged,
  };
}

module.exports = { createConnectorManager };
