const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
async function setup(t) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__meetingFolderPush;
  });
  installBrowserGlobals(t);
  const container = installHookDom(t);
  const listeners = {};
  const pushed = [];
  globalThis.__meetingFolderPush = pushed;
  let token = { token: null, generation: 1 },
    scope = null;
  Object.assign(globalThis.window.electronAPI, {
    authGetTokenState: async () => token,
    getActiveAccountScope: async () => scope,
    onAuthTokenStateChanged: (cb) => ((listeners.auth = cb), () => delete listeners.auth),
    onActiveAccountScopeChanged: (cb) => ((listeners.scope = cb), () => delete listeners.scope),
    onMeetingNotificationFolderCreated: (cb) => (
      (listeners.folder = cb),
      () => delete listeners.folder
    ),
    getFolders: async () => [{ id: 4, space_id: 1, name: "Test" }],
    getFolderNoteCounts: async () => [],
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "meeting-folder-refresh-",
    mockModules: {
      "/services/SyncService.js":
        "export const syncService={debouncedPush:(...args)=>globalThis.__meetingFolderPush.push(args)};",
    },
  });
  const store = await vite.ssrLoadModule("/stores/noteStore.ts");
  function Mounted() {
    React.useEffect(store.subscribeMeetingNotificationFolders, []);
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Mounted)));

  return {
    store,
    listeners,
    pushed,
    change: () => {
      token = { token: "other", generation: 2 };
      scope = { accountId: "other", authGeneration: 2 };
      listeners.auth({ hasToken: true, generation: 2 });
    },
  };
}
test("mounted local folder hint refreshes without a cloud lease and schedules existing sync", async (t) => {
  const { store, listeners, pushed } = await setup(t);
  await listeners.folder({ folderId: 4, accountId: null, authGeneration: 1 });
  assert.equal(store.getFoldersValue()[0].id, 4);
  assert.deepEqual(pushed, [["folder", 4]]);
  await listeners.folder({ folderId: 9, accountId: "wrong", authGeneration: 1 });
  assert.equal(pushed.length, 1);
});
test("an account change during folder loading prevents row application and sync", async (t) => {
  const { store, listeners, pushed, change } = await setup(t);
  let resolve;
  globalThis.window.electronAPI.getFolders = () => new Promise((r) => (resolve = r));
  const pending = listeners.folder({ folderId: 4, accountId: null, authGeneration: 1 });
  while (!resolve) await new Promise(setImmediate);
  change();
  resolve([{ id: 4, name: "Old account" }]);
  await pending;
  assert.equal(store.getFoldersValue().length, 0);
  assert.deepEqual(pushed, []);
});
