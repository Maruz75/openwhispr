const test = require("node:test");
const assert = require("node:assert/strict");

const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function loadReasoningService(t, cachePrefix) {
  installBrowserGlobals(t, {});
  const vite = await createRendererServer(t, { cachePrefix });
  const reasoningService = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  const { usePolicyStore } = await vite.ssrLoadModule("/stores/policyStore.ts");
  usePolicyStore.setState({ status: "unmanaged", appVersion: "1.10.0", policy: null });
  const { default: logger } = await vite.ssrLoadModule("/utils/logger.ts");
  t.after(() => reasoningService.destroy());
  return { reasoningService, logger };
}

// callChatCompletionsApi (LAN/Groq/Corti) logged the server's error body as
// `errorMessage`. Some self-hosted servers nest a code/type object with no
// .message field, and stringifying an object directly prints the useless
// "[object Object]" rather than anything that helps debug the failure.
test("a nested error object with no .message logs its content, not [object Object]", async (t) => {
  const { reasoningService, logger } = await loadReasoningService(
    t,
    "openwhispr-error-logging-test-"
  );
  const logs = [];
  t.mock.method(logger, "logReasoning", (event, data) => logs.push({ event, data }));

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: "invalid_request", type: "no_message_here" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

  await assert.rejects(
    reasoningService.processText("clean this up", "some-model", null, {
      lanUrl: "http://127.0.0.1:11434/v1",
    })
  );

  const detail = logs.find(({ event }) => event === "LAN_API_ERROR_DETAIL");
  assert.ok(detail, "LAN_API_ERROR_DETAIL must be logged");
  assert.equal(detail.data.errorMessage.includes("[object Object]"), false);
  assert.match(detail.data.errorMessage, /invalid_request/);
  assert.match(detail.data.errorMessage, /no_message_here/);
});

test("an error.message string still logs as-is", async (t) => {
  const { reasoningService, logger } = await loadReasoningService(
    t,
    "openwhispr-error-logging-message-test-"
  );
  const logs = [];
  t.mock.method(logger, "logReasoning", (event, data) => logs.push({ event, data }));

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "Incorrect API key provided" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

  await assert.rejects(
    reasoningService.processText("clean this up", "some-model", null, {
      lanUrl: "http://127.0.0.1:11434/v1",
    })
  );

  const detail = logs.find(({ event }) => event === "LAN_API_ERROR_DETAIL");
  assert.equal(detail.data.errorMessage, "Incorrect API key provided");
});
