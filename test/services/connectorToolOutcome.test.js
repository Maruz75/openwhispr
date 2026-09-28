const test = require("node:test");
const assert = require("node:assert/strict");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");

const loadOutcome = () => import("../../src/services/tools/connectors/toolOutcome.ts");
// tsx loads the ESM default export of src/i18n.ts through CommonJS interop.
const loadI18n = async () => {
  const mod = await import("../../src/i18n.ts");
  return mod.default.default ?? mod.default;
};
const loadRun = () => import("../../src/services/tools/connectors/runApprovalAction.ts");
const loadStore = () => import("../../src/stores/connectorApprovalStore.ts");

test("every approval outcome tells the model what happened and whether to retry", async () => {
  const { approvalOutcomeResult } = await loadOutcome();

  assert.deepEqual(
    approvalOutcomeResult({ state: "sent", url: "u", finalText: "edited" }, "#eng").data,
    {
      status: "sent",
      url: "u",
      destination: "#eng",
      finalText: "edited",
    }
  );
  assert.equal(
    approvalOutcomeResult({ state: "cancelled" }, "#eng").data.status,
    "cancelled_by_user"
  );
  assert.match(approvalOutcomeResult({ state: "cancelled" }, "#eng").data.guidance, /Do not retry/);
  assert.deepEqual(
    approvalOutcomeResult({ state: "not_sent", reason: "expired" }, "#eng").data.reason,
    "expired"
  );
  assert.equal(
    approvalOutcomeResult(
      { state: "failed", errorCode: "not_in_channel", message: "Not a member" },
      "#eng"
    ).data.error,
    "Not a member"
  );
  const unknown = approvalOutcomeResult({ state: "unknown" }, "#eng").data;
  assert.equal(unknown.status, "unknown");
  assert.match(unknown.guidance, /may or may not have been sent/);
  assert.match(unknown.guidance, /#eng/);
});

test("runApprovalAction without a chat context refuses to prepare", async (t) => {
  let prepared = 0;
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        connectorPrepare: async () => {
          prepared += 1;
        },
      },
    },
  });
  const { runApprovalAction } = await loadRun();
  const result = await runApprovalAction(undefined, "slack", "send_message", {});
  assert.equal(result.data.status, "unavailable");
  assert.equal(prepared, 0);
});

test("runApprovalAction passes clarifications straight back to the model", async (t) => {
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        connectorPrepare: async () => ({
          status: "needs_clarification",
          message: "Which channel?",
          candidates: ["#eng-web", "#eng-ios"],
        }),
      },
    },
  });
  const { runApprovalAction } = await loadRun();
  const controller = new AbortController();
  const result = await runApprovalAction(
    { messageId: "m1", toolCallId: "call-1", signal: controller.signal, onApprovalRequested() {} },
    "slack",
    "send_message",
    { destination: "#eng" }
  );
  assert.deepEqual(result.data, {
    status: "needs_clarification",
    message: "Which channel?",
    candidates: ["#eng-web", "#eng-ios"],
  });
});

test("runApprovalAction waits for the card and returns the send", async (t) => {
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        connectorPrepare: async () => ({
          status: "ready",
          actionId: "a1",
          preview: {
            verbKey: "default",
            destinationLabel: "#eng",
            accountLabel: "chad",
            body: "hi",
          },
        }),
        connectorCommit: async () => ({ state: "sent", url: "https://slack.test/p/9" }),
        connectorCancel: async () => ({ cancelled: true }),
      },
    },
  });
  const { runApprovalAction } = await loadRun();
  const { approvalKey, approveAction, useConnectorApprovalStore } = await loadStore();
  useConnectorApprovalStore.setState({ entries: {} });
  const controller = new AbortController();

  const pending = runApprovalAction(
    { messageId: "m1", toolCallId: "call-2", signal: controller.signal, onApprovalRequested() {} },
    "slack",
    "send_message",
    { destination: "#eng", text: "hi" }
  );
  await new Promise((resolve) => setImmediate(resolve));
  await approveAction(approvalKey("m1", "call-2"));

  const result = await pending;
  assert.equal(result.data.status, "sent");
  assert.equal(result.data.url, "https://slack.test/p/9");
});

test("tool steps show the user plain, localized outcomes instead of codes", async () => {
  const {
    unavailableResult,
    failedResult,
    needsClarificationResult,
    notSentResult,
    approvalOutcomeResult,
  } = await loadOutcome();
  // The UI language otherwise follows the machine's locale.
  await (await loadI18n()).changeLanguage("en");

  assert.equal(
    unavailableResult("policy_blocked").displayText,
    "Connectors are turned off by your organization."
  );
  assert.equal(
    unavailableResult("policy_unavailable").displayText,
    "Connectors aren't available right now."
  );
  assert.equal(
    failedResult("open_failed", "Couldn't open your email app.").displayText,
    "Couldn't open your email app."
  );
  // A code with no toolStatus.errors translation falls back to the generic text.
  assert.equal(failedResult("mystery_error", "raw provider text").displayText, "That didn't work.");
  // The tool step maps codes exactly as the card does.
  assert.equal(failedResult("token_revoked", "raw").displayText, "Slack needs to be reconnected.");
  assert.equal(failedResult("ratelimited", "raw").displayText, "Slack is busy.");
  assert.equal(
    failedResult("ENOTFOUND", "raw").displayText,
    "Couldn't reach Slack. Nothing was sent."
  );
  assert.equal(
    failedResult("user_not_found", "raw").displayText,
    "Couldn't open the direct message. Nothing was sent."
  );
  assert.equal(
    failedResult("restricted_action", "raw").displayText,
    "That channel is read-only or restricted."
  );
  assert.equal(
    failedResult("credential_save_failed", "raw").displayText,
    "Couldn't save the Slack login on this computer. Nothing was sent."
  );
  // The model still gets the connector's own code and message.
  assert.deepEqual(failedResult("token_revoked", "raw").data, {
    status: "failed",
    errorCode: "token_revoked",
    error: "raw",
  });
  assert.equal(
    needsClarificationResult("Call find_contact first.").displayText,
    "Needs more details."
  );
  assert.equal(notSentResult("cancelled").displayText, "Not sent.");
  assert.equal(
    approvalOutcomeResult({ state: "sent", url: "u" }, "#eng").displayText,
    "Sent to #eng."
  );
  // The model still gets the precise codes and guidance.
  assert.equal(unavailableResult("policy_blocked").data.reason, "policy_blocked");
  assert.equal(
    needsClarificationResult("Call find_contact first.").data.message,
    "Call find_contact first."
  );
});

test("a sent email reports what the user sent, and an unknown one the connector's guidance", async () => {
  const { approvalOutcomeResult } = await loadOutcome();
  const final = { to: ["dana@acme.test"], cc: [], subject: "Q3", body: "Hi" };

  assert.deepEqual(
    approvalOutcomeResult({ state: "sent", url: "u", final }, "dana@acme.test").data,
    { status: "sent", url: "u", destination: "dana@acme.test", final }
  );
  assert.deepEqual(
    approvalOutcomeResult({ state: "unknown", checkUrl: "c" }, "dana@acme.test", {
      unknownGuidance: "Tell the user to check their Gmail Sent folder.",
    }).data,
    {
      status: "unknown",
      destination: "dana@acme.test",
      checkUrl: "c",
      guidance:
        "It may or may not have been sent. Do not retry this action unless the user asks you to. Tell the user to check their Gmail Sent folder.",
    }
  );
});

test("unavailable carries the caller's guidance, or the default no-retry rule", async () => {
  const { unavailableResult } = await loadOutcome();
  assert.equal(
    unavailableResult("reconnect_needed").data.guidance,
    "Do not retry this action unless the user asks you to."
  );
  assert.deepEqual(
    unavailableResult("reconnect_needed", "Tell the user to reconnect Gmail. Don't retry.").data,
    {
      status: "unavailable",
      reason: "reconnect_needed",
      guidance: "Tell the user to reconnect Gmail. Don't retry.",
    }
  );
});

test("a Gmail failure is worded for Gmail in the tool step; other connectors keep theirs", async () => {
  const { failedResult } = await loadOutcome();
  await (await loadI18n()).changeLanguage("en");

  for (const [errorCode, text] of [
    ["reconnect_needed", "Gmail needs to be reconnected."],
    ["ENOTFOUND", "Couldn't reach Gmail. Nothing was sent."],
    ["timeout", "Couldn't reach Gmail. Nothing was sent."],
    ["http_503", "Couldn't reach Gmail. Nothing was sent."],
    ["rate_limited", "Gmail is busy."],
    ["daily_limit", "Gmail's daily sending limit was reached."],
    ["domain_policy", "Blocked by your organization's Google admin."],
    ["too_many_recipients", "Too many recipients. Nothing was sent."],
    ["connection_changed", "The Gmail connection changed. Nothing was sent."],
    ["mystery_error", "That didn't work."],
  ]) {
    assert.equal(failedResult(errorCode, "raw", "gmail").displayText, text, errorCode);
  }
  assert.equal(
    failedResult("reconnect_needed", "raw", "slack").displayText,
    "Slack needs to be reconnected."
  );
  assert.equal(
    failedResult("reconnect_needed", "raw").displayText,
    "Slack needs to be reconnected."
  );
  assert.deepEqual(failedResult("daily_limit", "raw", "gmail").data, {
    status: "failed",
    errorCode: "daily_limit",
    error: "raw",
  });
});

test("runApprovalAction words a Gmail failure for Gmail and passes its unknown guidance on", async (t) => {
  let prepared;
  let committed;
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        connectorPrepare: async () => prepared,
        connectorCommit: async () => committed,
        connectorCancel: async () => ({ cancelled: true }),
      },
    },
  });
  const { runApprovalAction } = await loadRun();
  const { approvalKey, approveAction, useConnectorApprovalStore } = await loadStore();
  await (await loadI18n()).changeLanguage("en");
  useConnectorApprovalStore.setState({ entries: {} });
  const ctx = (toolCallId) => ({
    messageId: "m7",
    toolCallId,
    signal: new AbortController().signal,
    onApprovalRequested() {},
  });
  const options = { unknownGuidance: "Tell the user to check their Gmail Sent folder." };

  prepared = { status: "failed", errorCode: "too_many_recipients", message: "Too many." };
  const refused = await runApprovalAction(ctx("call-1"), "gmail", "send", {}, options);
  assert.equal(refused.data.status, "failed");
  assert.equal(refused.displayText, "Too many recipients. Nothing was sent.");

  prepared = {
    status: "ready",
    actionId: "a7",
    preview: {
      verbKey: "email",
      destinationLabel: "josh@acme.test",
      accountLabel: "you@example.test",
      body: "Hi",
      fields: { to: ["josh@acme.test"], cc: [], subject: "Q3", body: "Hi" },
    },
  };
  const send = async (toolCallId, result) => {
    committed = result;
    const pending = runApprovalAction(ctx(toolCallId), "gmail", "send", {}, options);
    await new Promise((resolve) => setImmediate(resolve));
    await approveAction(approvalKey("m7", toolCallId));
    return pending;
  };

  const failed = await send("call-2", {
    state: "failed",
    errorCode: "daily_limit",
    message: "Gmail's daily sending limit was reached.",
  });
  assert.equal(failed.displayText, "Gmail's daily sending limit was reached.");

  const unknown = await send("call-3", {
    state: "unknown",
    checkUrl: "https://mail.google.test/#sent",
  });
  assert.equal(unknown.data.checkUrl, "https://mail.google.test/#sent");
  assert.match(unknown.data.guidance, /Do not retry/);
  assert.match(unknown.data.guidance, /Gmail Sent folder/);
  assert.doesNotMatch(unknown.data.guidance, /check josh@acme\.test/);
  // The tool step says where to look, in Gmail's words.
  assert.equal(
    unknown.displayText,
    "Couldn't confirm the email to josh@acme.test was sent. Check your Gmail Sent folder."
  );

  // A connector without its own wording keeps the generic line.
  const { approvalOutcomeResult } = await loadOutcome();
  assert.equal(
    approvalOutcomeResult({ state: "unknown" }, "#eng", { connectorId: "slack" }).displayText,
    "Couldn't confirm it was sent. Check #eng."
  );
  assert.equal(
    approvalOutcomeResult({ state: "unknown" }, "#eng").displayText,
    "Couldn't confirm it was sent. Check #eng."
  );
});
