const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const loadRegistry = () => import("../../src/services/tools/ToolRegistry.ts");
const loadScope = () => import("../../src/components/chat/toolExecutionScope.ts");

function recordingTool(seen) {
  return {
    name: "record_context",
    description: "Records the context it was called with",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    readOnly: true,
    async execute(args, context) {
      seen.push({ args, context });
      return { success: true, data: { ok: true }, displayText: "ok" };
    },
  };
}

test("toAISDKFormat gives each call its own tool-call id and the shared scope", async () => {
  const { ToolRegistry } = await loadRegistry();
  const seen = [];
  const registry = new ToolRegistry();
  registry.register(recordingTool(seen));
  const controller = new AbortController();
  const onApprovalRequested = () => {};
  const tools = registry.toAISDKFormat((toolCallId) => ({
    messageId: "m1",
    toolCallId,
    signal: controller.signal,
    onApprovalRequested,
    onHoldDelivery() {},
  }));

  await tools.record_context.execute({ a: 1 }, { toolCallId: "call-1", messages: [] });
  await tools.record_context.execute({ a: 2 }, { toolCallId: "call-2", messages: [] });

  assert.deepEqual(
    seen.map((entry) => entry.context.toolCallId),
    ["call-1", "call-2"]
  );
  assert.equal(seen[0].context.signal, controller.signal);
  assert.equal(seen[1].context.onApprovalRequested, onApprovalRequested);
});

test("toAISDKFormat reports each call's display text next to the model's output", async () => {
  const { ToolRegistry } = await loadRegistry();
  const registry = new ToolRegistry();
  registry.register(recordingTool([]));
  const shown = [];
  const tools = registry.toAISDKFormat(undefined, (toolCallId, displayText) =>
    shown.push({ toolCallId, displayText })
  );

  const output = await tools.record_context.execute({}, { toolCallId: "call-7", messages: [] });

  assert.deepEqual(output, { ok: true });
  assert.deepEqual(shown, [{ toolCallId: "call-7", displayText: "ok" }]);
});

test("toAISDKFormat without a context factory passes no context", async () => {
  const { ToolRegistry } = await loadRegistry();
  const seen = [];
  const registry = new ToolRegistry();
  registry.register(recordingTool(seen));

  await registry.toAISDKFormat().record_context.execute({}, { toolCallId: "call-3", messages: [] });

  assert.equal(seen[0].context, undefined);
});

test("a tool execution scope shares one signal and aborts it once", async () => {
  const { createToolExecutionScope } = await loadScope();
  let approvals = 0;
  let holds = 0;
  const scope = createToolExecutionScope({
    onApprovalRequested: () => {
      approvals += 1;
    },
    onHoldDelivery: () => {
      holds += 1;
    },
  });
  const first = scope.createContext({ messageId: "m1", toolCallId: "call-a" });
  const second = scope.createContext({ messageId: "m1", toolCallId: "call-b" });

  assert.equal(first.toolCallId, "call-a");
  assert.equal(first.signal, second.signal);
  assert.equal(first.signal.aborted, false);
  first.onApprovalRequested();
  second.onHoldDelivery();
  assert.equal(approvals, 1);
  assert.equal(holds, 1);

  scope.abort();
  scope.abort();
  assert.equal(second.signal.aborted, true);
});

test("a scope's notices do nothing once its turn has ended", async () => {
  const { createToolExecutionScope } = await loadScope();
  let notices = 0;
  const scope = createToolExecutionScope({
    onApprovalRequested: () => {
      notices += 1;
    },
    onHoldDelivery: () => {
      notices += 1;
    },
  });
  const context = scope.createContext({ messageId: "m1", toolCallId: "call-d" });

  // A slow tool result arriving after Esc must not reopen a dismissed panel.
  scope.abort();
  context.onApprovalRequested();
  context.onHoldDelivery();

  assert.equal(notices, 0);
});

test("a scope without handlers ignores approval and delivery notices", async () => {
  const { createToolExecutionScope } = await loadScope();
  const context = createToolExecutionScope().createContext({
    messageId: "m1",
    toolCallId: "call-c",
  });
  assert.doesNotThrow(() => context.onApprovalRequested());
  assert.doesNotThrow(() => context.onHoldDelivery());
});

test("the cloud tool loop passes each call's id to executeToolCall", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-tool-context-cloud-test-",
  });
  const reasoningService = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  t.after(() => reasoningService.destroy());

  let step = 0;
  t.mock.method(reasoningService, "streamFromIPC", () => {
    step += 1;
    const events =
      step === 1
        ? [{ type: "tool_call", id: "call-9", name: "record_context", arguments: "{}" }]
        : [{ type: "content", text: "done" }];
    return {
      stream: (async function* () {
        for (const event of events) yield event;
      })(),
      wasCancelled: () => false,
    };
  });

  const received = [];
  const stream = reasoningService.processTextStreamingCloud([{ role: "user", content: "hi" }], {
    systemPrompt: "s",
    tools: [{ name: "record_context", description: "d", parameters: {} }],
    executeToolCall: async (name, _args, toolCallId) => {
      received.push({ name, toolCallId });
      return { data: "ok", displayText: "ok" };
    },
  });
  for await (const _chunk of stream) {
    // drain
  }

  assert.deepEqual(received, [{ name: "record_context", toolCallId: "call-9" }]);
});

test("toAISDKFormat hands the SDK's own abort signal to the context factory", async () => {
  const { ToolRegistry } = await loadRegistry();
  const seen = [];
  const registry = new ToolRegistry();
  registry.register(recordingTool(seen));
  const factoryCalls = [];
  const tools = registry.toAISDKFormat((toolCallId, abortSignal) => {
    factoryCalls.push({ toolCallId, abortSignal });
    return {
      messageId: "m1",
      toolCallId,
      signal: abortSignal ?? new AbortController().signal,
      onApprovalRequested() {},
      onHoldDelivery() {},
    };
  });
  const sdk = new AbortController();

  await tools.record_context.execute(
    {},
    { toolCallId: "call-1", messages: [], abortSignal: sdk.signal }
  );

  assert.equal(factoryCalls[0].toolCallId, "call-1");
  assert.equal(factoryCalls[0].abortSignal, sdk.signal);
});

test("a context signal aborts when either its turn or its own SDK call aborts", async () => {
  const { createToolExecutionScope } = await loadScope();
  const scope = createToolExecutionScope();
  const sdk = new AbortController();
  const linked = scope.createContext({ messageId: "m1", toolCallId: "call-a", signal: sdk.signal });
  const plain = scope.createContext({ messageId: "m1", toolCallId: "call-b" });

  assert.equal(linked.messageId, "m1");
  assert.equal(linked.signal.aborted, false);
  sdk.abort();
  assert.equal(linked.signal.aborted, true);
  assert.equal(plain.signal.aborted, false, "one call's SDK abort leaves the other calls alone");

  scope.abort();
  assert.equal(plain.signal.aborted, true);
});
