const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// Drives the real useChatStreaming hook (one synchronous render, then its
// sendToAI closure; see useChatStreamingCancellation.test.js) on the
// OpenWhispr Cloud path, with the stream itself stubbed so the test can see
// which tools a send offers the model.
async function renderChatStreaming(
  t,
  hookOptions = {},
  { settings = {}, electronAPI = {}, subscribed = true } = {}
) {
  installBrowserGlobals(t, {
    initialStorage: { isSubscribed: String(subscribed) },
    window: { electronAPI },
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-chat-streaming-tools-test-",
  });
  const [{ default: viteI18next }, { initReactI18next }] = await Promise.all([
    vite.ssrLoadModule("i18next"),
    vite.ssrLoadModule("react-i18next"),
  ]);
  if (!viteI18next.isInitialized) {
    const translation = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8")
    );
    await viteI18next.use(initReactI18next).init({
      lng: "en",
      resources: { en: { translation } },
      interpolation: { escapeValue: false },
    });
  }

  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { usePolicyStore } = await vite.ssrLoadModule("/stores/policyStore.ts");
  usePolicyStore.setState({ status: "unmanaged", appVersion: "1.10.0", policy: null });
  useSettingsStore.setState({ chatAgentMode: "openwhispr", isSignedIn: true, ...settings });

  const { useChatStreaming } = await vite.ssrLoadModule("/components/chat/useChatStreaming.ts");
  // The app's i18n module (loaded with the tools) follows the machine's locale.
  await (await vite.ssrLoadModule("/i18n.ts")).default.changeLanguage("en");
  const reasoningService = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  t.after(() => reasoningService.destroy());

  const offeredTools = [];
  const endStream = async function* () {
    yield { type: "done", finishReason: "stop" };
  };
  t.mock.method(reasoningService, "processTextStreamingCloud", (_messages, config) => {
    offeredTools.push((config.tools ?? []).map((tool) => tool.name));
    return endStream();
  });
  t.mock.method(
    reasoningService,
    "processTextStreamingAI",
    (_messages, _model, _provider, _config, tools) => {
      offeredTools.push(Object.keys(tools ?? {}));
      return endStream();
    }
  );

  let messages = [];
  const setMessages = (updater) => {
    messages = typeof updater === "function" ? updater(messages) : updater;
  };
  let captured = null;
  function Harness() {
    captured = useChatStreaming({ messages, setMessages, ...hookOptions });
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  return { captured, offeredTools, reasoningService, usePolicyStore, getMessages: () => messages };
}

// Typed chat, the voice panel and a note's chat opt in; container chat leaves it off.
const CONNECTOR_SURFACE = { allowConnectors: true };
const BYOK_SETTINGS = {
  chatAgentMode: "providers",
  chatAgentProvider: "openai",
  chatAgentModel: "gpt-5-mini",
};
const MANAGED_POLICY = {
  version: 1,
  transcription: { allowedModes: ["openwhispr"], allowedByokProviders: [] },
  llm: { allowedModes: ["openwhispr"], allowedByokProviders: [], allowedEnterpriseProviders: [] },
  features: { agentEnabled: true, webSearchEnabled: true, connectorsEnabled: true },
  sharing: { externalLinkSharing: "disabled" },
  dataRetention: {
    audioRetentionMaxDays: null,
    localHistoryMode: "user_choice",
    cloudBackupAllowed: true,
  },
  minAppVersion: null,
};

function offersConnectors(tools) {
  return tools.includes("email_draft") || tools.includes("find_contact");
}

test("a paid, signed-in chat offers the connector tools", async (t) => {
  const { captured, offeredTools } = await renderChatStreaming(t, CONNECTOR_SURFACE);
  await captured.sendToAI("Email Josh", []);
  assert.ok(offeredTools[0].includes("email_draft"));
  assert.ok(offeredTools[0].includes("find_contact"));
});

test("a surface that doesn't opt in (container chat) never offers them", async (t) => {
  const { captured, offeredTools } = await renderChatStreaming(t);
  await captured.sendToAI("Reply to Maria", []);
  assert.ok(offeredTools[0].length > 0);
  assert.equal(offersConnectors(offeredTools[0]), false);
});

test("a signed-out chat never offers them", async (t) => {
  const { captured, offeredTools } = await renderChatStreaming(t, CONNECTOR_SURFACE, {
    settings: { ...BYOK_SETTINGS, isSignedIn: false },
  });
  await captured.sendToAI("Email Josh", []);
  assert.ok(offeredTools[0].length > 0);
  assert.equal(offersConnectors(offeredTools[0]), false);
});

test("a free plan never offers them", async (t) => {
  const { captured, offeredTools } = await renderChatStreaming(t, CONNECTOR_SURFACE, {
    subscribed: false,
  });
  await captured.sendToAI("Email Josh", []);
  assert.ok(offeredTools[0].length > 0);
  assert.equal(offersConnectors(offeredTools[0]), false);
});

test("an org that turns connectors off mid-session removes them from the next send", async (t) => {
  const { captured, offeredTools, usePolicyStore } = await renderChatStreaming(
    t,
    CONNECTOR_SURFACE
  );
  usePolicyStore.setState({ status: "managed", appVersion: "1.10.0", policy: MANAGED_POLICY });
  await captured.sendToAI("Email Josh", []);
  usePolicyStore.setState({
    policy: {
      ...MANAGED_POLICY,
      features: { ...MANAGED_POLICY.features, connectorsEnabled: false },
    },
  });
  await captured.sendToAI("Email Josh again", []);

  assert.equal(offersConnectors(offeredTools[0]), true);
  assert.ok(offeredTools[1].length > 0);
  assert.equal(offersConnectors(offeredTools[1]), false);
});

test("on the AI SDK path a tool step shows the tool's own text, not a bare Done", async (t) => {
  const { captured, reasoningService, getMessages } = await renderChatStreaming(
    t,
    CONNECTOR_SURFACE,
    {
      settings: BYOK_SETTINGS,
      electronAPI: {
        connectorFindContacts: async () => ({
          contacts: [
            { name: "Gabe Torres", email: "gabe@example.com", lastMet: null },
            { name: "Gabriel Stone", email: "gabriel@acme.test", lastMet: null },
          ],
        }),
      },
    }
  );
  reasoningService.processTextStreamingAI.mock.mockImplementation(
    (_messages, _model, _provider, _config, tools) =>
      (async function* () {
        yield {
          type: "tool_calls",
          calls: [{ id: "call-1", name: "find_contact", arguments: "{}" }],
        };
        await tools.find_contact.execute({ name: "Gab" }, { toolCallId: "call-1", messages: [] });
        // What ReasoningService yields for any object output.
        yield {
          type: "tool_result",
          callId: "call-1",
          toolName: "find_contact",
          displayText: "Done",
        };
        yield { type: "done", finishReason: "stop" };
      })()
  );

  let holds = 0;
  await captured.sendToAI("Who is Gab?", [], { onHoldDelivery: () => (holds += 1) });

  const assistant = getMessages().find((message) => message.role === "assistant");
  assert.equal(assistant.toolCalls[0].result, "Contacts found: 2");
  // The AI SDK tools carry the turn's scope, so a tool's hold reaches the caller.
  assert.equal(holds, 1);
});

test("on the cloud path a tool's hold reaches the caller through the turn's scope", async (t) => {
  const { captured, reasoningService } = await renderChatStreaming(t, CONNECTOR_SURFACE, {
    electronAPI: { connectorFindContacts: async () => ({ contacts: [] }) },
  });
  reasoningService.processTextStreamingCloud.mock.mockImplementation((_messages, config) =>
    (async function* () {
      yield {
        type: "tool_calls",
        calls: [{ id: "srv-1", name: "find_contact", arguments: '{"name":"Zed"}' }],
      };
      const result = await config.executeToolCall("find_contact", '{"name":"Zed"}', "srv-1");
      yield {
        type: "tool_result",
        callId: "srv-1",
        toolName: "find_contact",
        displayText: result.displayText,
      };
      yield { type: "done", finishReason: "stop" };
    })()
  );

  let holds = 0;
  await captured.sendToAI("Who is Zed?", [], { onHoldDelivery: () => (holds += 1) });

  assert.equal(holds, 1);
});

test("Esc settles a send whose tool never finishes, and a late result is dropped", async (t) => {
  let finishLookup;
  const { captured, reasoningService } = await renderChatStreaming(t, CONNECTOR_SURFACE, {
    electronAPI: {
      connectorFindContacts: () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    },
  });
  let toolResult;
  reasoningService.processTextStreamingCloud.mock.mockImplementation((_messages, config) =>
    (async function* () {
      yield {
        type: "tool_calls",
        calls: [{ id: "srv-2", name: "find_contact", arguments: '{"name":"Zed"}' }],
      };
      toolResult = await config.executeToolCall("find_contact", '{"name":"Zed"}', "srv-2");
      yield { type: "done", finishReason: "stop" };
    })()
  );

  const sending = captured.sendToAI("Who is Zed?", []);
  await new Promise((resolve) => setTimeout(resolve, 20));
  captured.cancelStream();
  const outcome = await Promise.race([
    sending.then(() => "settled"),
    new Promise((resolve) => setTimeout(() => resolve("still waiting on the tool"), 1000)),
  ]);
  finishLookup({ contacts: [{ name: "Zed", email: "zed@example.com", lastMet: null }] });

  assert.equal(outcome, "settled");
  assert.equal(toolResult.displayText, "");
});

test("an error before the stream starts still rejects the send and adds no messages", async (t) => {
  const { captured, getMessages } = await renderChatStreaming(
    t,
    {},
    {
      // Snippet triggers are read while the tool registry is built, before any stream.
      settings: { snippets: null },
    }
  );
  await assert.rejects(() => captured.sendToAI("hi", []), TypeError);
  assert.equal(getMessages().length, 0);
});

// A draft still waiting on main when its turn ends is released through the
// turn's signal (the cancel names its run), however the send ended.
const STREAM_ENDINGS = {
  completes: () => [{ type: "done", finishReason: "stop" }],
  fails: () => {
    throw new Error("stream dropped");
  },
};
for (const [ending, finishStream] of Object.entries(STREAM_ENDINGS)) {
  test(`a send that ${ending} releases a tool still running in its turn`, async (t) => {
    const cancels = [];
    const { captured, reasoningService } = await renderChatStreaming(t, CONNECTOR_SURFACE, {
      electronAPI: {
        connectorRunDirect: () => new Promise(() => {}),
        connectorCancel: async (runId, reason) => cancels.push(reason),
      },
    });
    reasoningService.processTextStreamingCloud.mock.mockImplementation((_messages, config) =>
      (async function* () {
        void config.executeToolCall(
          "email_draft",
          JSON.stringify({ to: ["zed@example.com"], subject: "Hi", body: "Hello" }),
          "srv-3"
        );
        yield* finishStream();
      })()
    );

    await captured.sendToAI("Email Zed", []);

    assert.deepEqual(cancels, ["cancelled_by_user"]);
  });
}

// Sends that each wait on an email draft main never finishes, so a turn only
// ends once its tool scope is aborted. Returns the run ids main was asked to
// open and to cancel, in order.
async function renderDraftTurns(t, streamForSend) {
  const opened = [];
  const cancelled = [];
  let notifyOpened = () => {};
  const { captured, reasoningService } = await renderChatStreaming(t, CONNECTOR_SURFACE, {
    electronAPI: {
      connectorRunDirect: (_connector, _action, _draft, runId) => {
        opened.push(runId);
        notifyOpened();
        return new Promise(() => {});
      },
      connectorCancel: async (runId) => cancelled.push(runId),
    },
  });
  let sends = 0;
  reasoningService.processTextStreamingCloud.mock.mockImplementation((_messages, config) =>
    streamForSend(sends++, config)
  );
  const nextDraftOpened = () =>
    new Promise((resolve) => {
      notifyOpened = resolve;
    });
  return { captured, opened, cancelled, nextDraftOpened };
}

function awaitDraft(config, callId) {
  return (async function* () {
    await config.executeToolCall(
      "email_draft",
      JSON.stringify({ to: ["zed@example.com"], subject: "Hi", body: "Hello" }),
      callId
    );
    yield { type: "done", finishReason: "stop" };
  })();
}

const settlesWithin = (promise, ms = 1000) =>
  Promise.race([
    promise.then(() => "settled"),
    new Promise((resolve) => setTimeout(() => resolve("still waiting"), ms)),
  ]);

test("a newer send releases the tools of the send it replaces", async (t) => {
  const { captured, opened, cancelled, nextDraftOpened } = await renderDraftTurns(
    t,
    (send, config) =>
      send === 0
        ? awaitDraft(config, "srv-old")
        : (async function* () {
            yield { type: "done", finishReason: "stop" };
          })()
  );

  const draftOpened = nextDraftOpened();
  const first = captured.sendToAI("Email Zed", []);
  await draftOpened;
  await captured.sendToAI("Never mind", []);

  assert.equal(await settlesWithin(first), "settled");
  assert.deepEqual(cancelled, opened);
});

test("a replaced send that ends leaves the newer send cancellable", async (t) => {
  const { captured, opened, cancelled, nextDraftOpened } = await renderDraftTurns(
    t,
    (send, config) => awaitDraft(config, `srv-${send}`)
  );

  let draftOpened = nextDraftOpened();
  const first = captured.sendToAI("Email Zed", []);
  await draftOpened;
  draftOpened = nextDraftOpened();
  const second = captured.sendToAI("Email Zed again", []);
  await draftOpened;
  // The first send's cleanup runs now; it must not drop the second's scope.
  assert.equal(await settlesWithin(first), "settled");
  captured.cancelStream();

  assert.equal(await settlesWithin(second), "settled");
  assert.deepEqual(cancelled, opened);
});

// The Gmail connector's status as main reports it.
const GMAIL = {
  id: "gmail",
  connected: true,
  configured: true,
  accountLabel: "you@example.test",
  workspaceLabel: null,
  needsReconnect: false,
};

// Renders a connector surface whose status load answers with `statuses`, and
// captures each send's offered tools (with descriptions). `duringStream` runs
// inside the stream, while the turn's tools can still run.
async function renderWithStatuses(t, statuses, { electronAPI = {}, duringStream } = {}) {
  const rendered = await renderChatStreaming(t, CONNECTOR_SURFACE, {
    electronAPI: {
      connectorStatus: async () => statuses,
      onConnectorStatusChanged: () => () => {},
      ...electronAPI,
    },
  });
  const sends = [];
  rendered.reasoningService.processTextStreamingCloud.mock.mockImplementation(
    (_messages, config) => {
      sends.push(config);
      return (async function* () {
        await duringStream?.(config);
        yield { type: "done", finishReason: "stop" };
      })();
    }
  );
  return { ...rendered, sends };
}

const emailDraftDescription = (config) =>
  config.tools.find((tool) => tool.name === "email_draft").description;

test("a connected Gmail turns email_draft into a card the user sends from the chat", async (t) => {
  const { captured, sends } = await renderWithStatuses(t, [GMAIL]);
  await captured.sendToAI("Email Josh the Q3 numbers", []);
  assert.match(emailDraftDescription(sends[0]), /card in the chat/);
});

test("without Gmail, Automatic keeps the compose window", async (t) => {
  const { captured, sends } = await renderWithStatuses(t, [{ ...GMAIL, connected: false }]);
  await captured.sendToAI("Email Josh the Q3 numbers", []);
  assert.match(emailDraftDescription(sends[0]), /This never sends email/);
});

test("a Gmail login that needs reconnecting asks for a reconnect instead of opening a compose window", async (t) => {
  const calls = { prepare: 0, runDirect: 0 };
  let result;
  const { captured, sends } = await renderWithStatuses(t, [{ ...GMAIL, needsReconnect: true }], {
    electronAPI: {
      connectorPrepare: async () => {
        calls.prepare += 1;
      },
      connectorRunDirect: async () => {
        calls.runDirect += 1;
      },
    },
    duringStream: async (config) => {
      result = await config.executeToolCall(
        "email_draft",
        JSON.stringify({ to: ["josh@acme.test"], subject: "Q3", body: "Numbers." }),
        "srv-gmail"
      );
    },
  });
  await captured.sendToAI("Email Josh the Q3 numbers", []);

  assert.match(emailDraftDescription(sends[0]), /card in the chat/);
  assert.equal(JSON.parse(result.data).reason, "reconnect_needed");
  assert.deepEqual(calls, { prepare: 0, runDirect: 0 });
});

// A meeting note's participants as the note row stores them.
const NOTE_ATTENDEES = [
  { email: "dana@example.com", displayName: "Dana Wu", responseStatus: "accepted", self: false },
  { email: "me@example.com", displayName: "Me", responseStatus: "accepted", self: true },
];

// A note chat whose system prompt is captured per send; main's attendee
// filter answers with `answer` and records what it was asked.
async function renderNoteChat(t, hookOptions, { answer, subscribed = true } = {}) {
  const lookups = [];
  const eventIds = [];
  const rendered = await renderChatStreaming(
    t,
    { noteContext: "Note ID: 7\nTitle: Kickoff", noteAttendees: NOTE_ATTENDEES, ...hookOptions },
    {
      subscribed,
      electronAPI: {
        connectorNoteAttendees: async (participants, calendarEventId) => {
          lookups.push(participants);
          eventIds.push(calendarEventId);
          if (answer instanceof Error) throw answer;
          return answer ?? { attendees: [{ name: "Dana Wu", email: "dana@example.com" }] };
        },
      },
    }
  );
  const prompts = [];
  rendered.reasoningService.processTextStreamingCloud.mock.mockImplementation(
    (_messages, config) => {
      prompts.push(config.systemPrompt);
      return (async function* () {
        yield { type: "done", finishReason: "stop" };
      })();
    }
  );
  return { ...rendered, lookups, eventIds, prompts };
}

test("a note chat with connectors lists the note's attendees and how to read 'everyone'", async (t) => {
  const { captured, lookups, prompts } = await renderNoteChat(t, CONNECTOR_SURFACE);
  await captured.sendToAI("Draft a follow-up to everyone", []);

  assert.deepEqual(lookups, [NOTE_ATTENDEES]);
  assert.match(prompts[0], /Meeting attendees/);
  assert.match(prompts[0], /- Dana Wu <dana@example\.com>/);
  assert.match(prompts[0], /"everyone"/);
  assert.match(prompts[0], /find_contact/);
  assert.match(prompts[0], /Title: Kickoff/);
});

test("a meeting note's calendar event goes with the lookup, so main can add its organizer", async (t) => {
  const { captured, lookups, eventIds, prompts } = await renderNoteChat(
    t,
    { ...CONNECTOR_SURFACE, noteAttendees: [], noteCalendarEventId: "event-1" },
    { answer: { attendees: [{ name: null, email: "lee@example.com" }] } }
  );
  await captured.sendToAI("Draft a follow-up to everyone", []);

  assert.deepEqual(lookups, [[]], "an organizer-only meeting is still looked up");
  assert.deepEqual(eventIds, ["event-1"]);
  assert.match(prompts[0], /- lee@example\.com/);
});

test("a chat that offers no connector tools never looks up or lists attendees", async (t) => {
  const { captured, lookups, prompts } = await renderNoteChat(t, {});
  await captured.sendToAI("Summarize this", []);

  assert.deepEqual(lookups, []);
  assert.doesNotMatch(prompts[0], /Meeting attendees/);
  assert.match(prompts[0], /Title: Kickoff/, "the note itself is still there");
});

test("a free plan's note chat never looks up or lists attendees", async (t) => {
  const { captured, lookups, prompts } = await renderNoteChat(t, CONNECTOR_SURFACE, {
    subscribed: false,
  });
  await captured.sendToAI("Draft a follow-up to everyone", []);

  assert.deepEqual(lookups, []);
  assert.doesNotMatch(prompts[0], /Meeting attendees/);
});

test("a note without attendees skips the lookup and gets no block", async (t) => {
  const { captured, lookups, prompts } = await renderNoteChat(
    t,
    { ...CONNECTOR_SURFACE, noteAttendees: [] },
    { answer: { attendees: [] } }
  );
  await captured.sendToAI("Draft a follow-up", []);
  assert.deepEqual(lookups, [], "an empty note skips the lookup");
  assert.doesNotMatch(prompts[0], /Meeting attendees/);
});

test("attendees main filters out entirely leave no block", async (t) => {
  const { captured, lookups, prompts } = await renderNoteChat(t, CONNECTOR_SURFACE, {
    answer: { attendees: [] },
  });
  await captured.sendToAI("Draft a follow-up", []);
  assert.equal(lookups.length, 1);
  assert.doesNotMatch(prompts[0], /Meeting attendees/);
});

test("a failed attendee lookup still answers, without the block", async (t) => {
  const { captured, prompts } = await renderNoteChat(t, CONNECTOR_SURFACE, {
    answer: new Error("no handler"),
  });
  await captured.sendToAI("Draft a follow-up", []);
  assert.equal(prompts.length, 1);
  assert.doesNotMatch(prompts[0], /Meeting attendees/);
});
