const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// The note and container chat hooks with the streaming hook replaced by one
// that records the options each surface passes it.
const MOCKS = {
  "/chat/useChatStreaming": `
    export function useChatStreaming(options) {
      globalThis.__surfaceStreamingOptions = options;
      return {
        agentState: "idle",
        toolStatus: "",
        activeToolName: "",
        sendToAI: async () => {},
        cancelStream() {},
      };
    }
  `,
  "/chat/useChatPersistence": `
    export function useChatPersistence() {
      return {
        conversationId: null,
        messages: [],
        setMessages() {},
        createConversation: async () => 1,
        saveUserMessage: async () => {},
        saveAssistantMessage() {},
        loadConversation: async () => {},
        handleNewChat() {},
      };
    }
  `,
};

async function streamingOptionsOf(t, hookPath, exportName, hookOptions) {
  t.after(() => {
    delete globalThis.__surfaceStreamingOptions;
  });
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-chat-surfaces-connectors-test-",
    mockModules: MOCKS,
  });
  const useHook = (await vite.ssrLoadModule(hookPath))[exportName];
  function Harness() {
    useHook(hookOptions);
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  return globalThis.__surfaceStreamingOptions;
}

const PARTICIPANTS = JSON.stringify([
  { email: "dana@example.com", displayName: "Dana Wu", responseStatus: "accepted", self: false },
  { email: "me@example.com", displayName: "Me", responseStatus: "accepted", self: true },
]);

test("a note's chat offers the connector tools, with the note's attendees", async (t) => {
  const options = await streamingOptionsOf(t, "/hooks/useEmbeddedChat.ts", "useEmbeddedChat", {
    noteId: 7,
    folderId: null,
    noteTitle: "Kickoff",
    noteContent: "Action items",
    noteParticipants: PARTICIPANTS,
  });

  assert.equal(options.allowConnectors, true);
  // Parsed as stored; main drops the user and rooms per send.
  assert.deepEqual(options.noteAttendees, JSON.parse(PARTICIPANTS));
});

test("a team note someone else recorded passes its recorder as an attendee, never the viewer", async (t) => {
  const options = await streamingOptionsOf(t, "/hooks/useEmbeddedChat.ts", "useEmbeddedChat", {
    noteId: 7,
    folderId: null,
    noteTitle: "Kickoff",
    noteContent: "",
    noteParticipants: JSON.stringify([
      { email: "alice@example.com", displayName: "Alice", responseStatus: null, self: true },
      { email: "chad@example.com", displayName: "Chad", responseStatus: null, self: false },
    ]),
    noteOwnedByUser: false,
    selfEmail: "chad@example.com",
  });

  assert.deepEqual(options.noteAttendees, [
    { email: "alice@example.com", displayName: "Alice", responseStatus: null, self: false },
  ]);
});

test("a note whose participants are missing or malformed passes no attendees", async (t) => {
  const options = await streamingOptionsOf(t, "/hooks/useEmbeddedChat.ts", "useEmbeddedChat", {
    noteId: 7,
    folderId: null,
    noteTitle: "Kickoff",
    noteContent: "",
    noteParticipants: "{not json",
  });
  assert.equal(options.allowConnectors, true);
  assert.deepEqual(options.noteAttendees, []);
});

test("a folder or space chat never offers the connector tools", async (t) => {
  const options = await streamingOptionsOf(t, "/hooks/useContainerChat.ts", "useContainerChat", {
    space: { id: 1, name: "Team" },
    folder: null,
    notes: [],
  });

  assert.notEqual(options.allowConnectors, true);
  assert.equal(options.noteAttendees, undefined);
});
