const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { installInteractiveDom, findElement } = require("../lib/interactiveDom");

function click(element) {
  element.dispatchEvent({
    type: "click",
    bubbles: true,
    button: 0,
    defaultPrevented: false,
    cancelBubble: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.cancelBubble = true;
    },
  });
}

function findButton(root, label) {
  return findElement(
    root,
    (element) => element.tagName === "BUTTON" && element.textContent === label
  );
}

// A boolean, so a failed assertion never tries to print a DOM node.
function hasButton(root, label) {
  return Boolean(findButton(root, label));
}

function button(root, label) {
  const found = findButton(root, label);
  assert.ok(found, `button ${label} is rendered`);
  return found;
}

const GITHUB = {
  id: "github",
  connected: true,
  configured: true,
  accountLabel: "@dana",
  workspaceLabel: "3",
  needsReconnect: false,
  manageUrl: "https://github.com/apps/openwhispr-dev/installations/new",
};
const DISCONNECTED = {
  ...GITHUB,
  connected: false,
  accountLabel: null,
  workspaceLabel: null,
  manageUrl: undefined,
};
const EXPIRES_AT = Date.UTC(2026, 8, 28, 15, 45);
const PROGRESS = {
  connectorId: "github",
  userCode: "WDJB-MJHT",
  verificationUri: "https://github.com/login/device",
  expiresAt: EXPIRES_AT,
};
// The same format the device code uses, in the mocked "en" UI language.
const EXPIRY = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(
  EXPIRES_AT
);

// A Connect that stays open until the test settles it, as the device flow does.
function pendingConnect() {
  const calls = [];
  let settle = () => {};
  return {
    calls,
    connectorConnect: (connectorId) => {
      calls.push(connectorId);
      return new Promise((resolve) => {
        settle = resolve;
      });
    },
    settle: (result) => settle(result),
  };
}

// The GitHub entry of CONNECTOR_ROWS on the real row and status store.
async function renderGithubRow(
  t,
  { status, isPaid = true, blockedByOrg = false, electronAPI = {}, rowId = "github" } = {}
) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const progressListeners = new Set();
  const statusListeners = new Set();
  const opened = [];
  const copied = [];
  const cancels = [];
  // Real window focus/blur never fires in this harness, so the repositories
  // button's one-shot "came back to the window" listener is captured here and
  // fired manually with dispatchFocus.
  const focusListeners = new Map();
  installBrowserGlobals(t, {
    window: {
      addEventListener: (type, listener, options) => {
        if (type === "focus") focusListeners.set(listener, Boolean(options && options.once));
      },
      removeEventListener: (type, listener) => {
        if (type === "focus") focusListeners.delete(listener);
      },
      electronAPI: {
        connectorStatus: async () => (status ? [status] : []),
        onConnectorStatusChanged: (callback) => {
          statusListeners.add(callback);
          return () => statusListeners.delete(callback);
        },
        connectorRecentActions: async () => [],
        onConnectorConnectProgress: (callback) => {
          progressListeners.add(callback);
          return () => progressListeners.delete(callback);
        },
        writeClipboard: async (text) => {
          copied.push(text);
          return { success: true };
        },
        openExternal: async (url) => {
          opened.push(url);
          return { success: true };
        },
        connectorCancelConnect: async (connectorId) => {
          cancels.push(connectorId);
          return { status: "cancelled" };
        },
        ...electronAPI,
      },
    },
  });
  const container = installInteractiveDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-github-connector-row-test-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `
        const t = (key, options) => (options ? key + JSON.stringify(options) : key);
        export const useTranslation = () => ({ t, i18n: { language: "en" } });
      `,
      "/ui/button": `
        import React from "react";
        export function Button(props) { return React.createElement("button", props); }
      `,
      "/ui/SettingsSection": `
        import React from "react";
        export const SettingsPanelRow = ({ children }) => React.createElement("div", null, children);
        export const SettingsPanel = SettingsPanelRow;
      `,
    },
  });
  const [{ ConnectorLoginRow }, { CONNECTOR_ROWS }] = await Promise.all([
    vite.ssrLoadModule("/components/connectors/ConnectorLoginRow.tsx"),
    vite.ssrLoadModule("/components/connectors/connectorRows.tsx"),
  ]);
  const row = CONNECTOR_ROWS.find((entry) => entry.id === rowId);
  assert.ok(row, `CONNECTOR_ROWS has a ${rowId} entry`);
  const { createRoot } = require("react-dom/client");
  root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(ConnectorLoginRow, { row, isPaid, blockedByOrg, onUpgrade() {} })
    )
  );
  // Let the status load from the mount effect commit.
  await React.act(async () => {});
  const emitProgress = (progress) =>
    React.act(async () => {
      for (const listener of [...progressListeners]) listener(progress);
    });
  // What main broadcasts after a connect or disconnect changes the login.
  const broadcastStatus = (statuses) => {
    for (const listener of [...statusListeners]) listener(statuses);
  };
  // Leaving Settings: the whole row goes away.
  const unmount = async () => {
    await React.act(async () => root.unmount());
    root = null;
  };
  const dispatchFocus = () =>
    React.act(async () => {
      for (const [listener, once] of [...focusListeners]) {
        if (once) focusListeners.delete(listener);
        listener();
      }
    });
  return {
    container,
    emitProgress,
    progressListeners,
    broadcastStatus,
    unmount,
    opened,
    copied,
    cancels,
    dispatchFocus,
    focusListeners,
  };
}

test("GitHub is listed after Gmail and Slack", async (t) => {
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-github-connector-rows-order-",
  });
  const { CONNECTOR_ROWS } = await vite.ssrLoadModule("/components/connectors/connectorRows.tsx");
  const ids = CONNECTOR_ROWS.map((row) => row.id);
  assert.deepEqual(ids.slice(0, 2), ["gmail", "slack"]);
  // Plan 4's Linear row sits before or after GitHub, whichever merged first.
  assert.deepEqual(
    ids.filter((id) => id === "github"),
    ["github"]
  );
});

test("a build without a GitHub App client shows no GitHub row", async (t) => {
  const { container } = await renderGithubRow(t, {
    status: { ...DISCONNECTED, configured: false },
  });
  assert.equal(container.textContent, "");
});

test("Connect shows GitHub's code once it arrives, and a newer code replaces it", async (t) => {
  const connect = pendingConnect();
  const { container, emitProgress } = await renderGithubRow(t, {
    status: DISCONNECTED,
    electronAPI: { connectorConnect: connect.connectorConnect },
  });

  await React.act(async () => click(button(container, "connectors.github.connect")));
  assert.deepEqual(connect.calls, ["github"]);
  assert.match(container.textContent, /connectors\.github\.connecting/);
  // No code until GitHub hands one out.
  assert.doesNotMatch(container.textContent, /deviceCode\.instructions/);

  await emitProgress(PROGRESS);
  assert.match(container.textContent, /connectors\.github\.deviceCode\.instructions/);
  assert.match(container.textContent, /WDJB-MJHT/);
  assert.ok(
    container.textContent.includes(
      `connectors.github.deviceCode.expires${JSON.stringify({ time: EXPIRY })}`
    ),
    "the expiry time is shown"
  );

  await emitProgress({ ...PROGRESS, userCode: "ABCD-EFGH", expiresAt: EXPIRES_AT + 60_000 });
  assert.match(container.textContent, /ABCD-EFGH/);
  assert.doesNotMatch(container.textContent, /WDJB-MJHT/);
});

test("another connector's progress never shows in the GitHub row", async (t) => {
  const connect = pendingConnect();
  const { container, emitProgress } = await renderGithubRow(t, {
    status: DISCONNECTED,
    electronAPI: { connectorConnect: connect.connectorConnect },
  });
  await React.act(async () => click(button(container, "connectors.github.connect")));

  await emitProgress({ ...PROGRESS, connectorId: "linear", userCode: "LINE-AR00" });
  assert.doesNotMatch(container.textContent, /LINE-AR00/);
  assert.doesNotMatch(container.textContent, /deviceCode\.instructions/);

  await emitProgress(PROGRESS);
  await emitProgress({ ...PROGRESS, connectorId: "linear", userCode: "LINE-AR00" });
  assert.match(container.textContent, /WDJB-MJHT/);
});

test("Copy & open GitHub copies the code and opens GitHub's device page", async (t) => {
  const connect = pendingConnect();
  const { container, emitProgress, copied, opened } = await renderGithubRow(t, {
    status: DISCONNECTED,
    electronAPI: { connectorConnect: connect.connectorConnect },
  });
  await React.act(async () => click(button(container, "connectors.github.connect")));
  await emitProgress(PROGRESS);

  await React.act(async () => click(button(container, "connectors.github.deviceCode.copyAndOpen")));

  assert.deepEqual(copied, ["WDJB-MJHT"]);
  assert.deepEqual(opened, ["https://github.com/login/device"]);
  assert.match(container.textContent, /connectors\.github\.deviceCode\.copied/);
});

test("a failed copy still opens GitHub, and never says the code was copied", async (t) => {
  const connect = pendingConnect();
  const { container, emitProgress, opened } = await renderGithubRow(t, {
    status: DISCONNECTED,
    electronAPI: {
      connectorConnect: connect.connectorConnect,
      writeClipboard: async () => {
        throw new Error("clipboard unavailable");
      },
    },
  });
  await React.act(async () => click(button(container, "connectors.github.connect")));
  await emitProgress(PROGRESS);

  await React.act(async () => click(button(container, "connectors.github.deviceCode.copyAndOpen")));

  assert.deepEqual(opened, ["https://github.com/login/device"]);
  assert.doesNotMatch(container.textContent, /deviceCode\.copied/);
});

test("a verification link off github.com is never opened", async (t) => {
  const connect = pendingConnect();
  const { container, emitProgress, opened } = await renderGithubRow(t, {
    status: DISCONNECTED,
    electronAPI: { connectorConnect: connect.connectorConnect },
  });
  await React.act(async () => click(button(container, "connectors.github.connect")));
  await emitProgress({ ...PROGRESS, verificationUri: "https://github.com.evil.test/login/device" });

  await React.act(async () => click(button(container, "connectors.github.deviceCode.copyAndOpen")));

  assert.deepEqual(opened, ["https://github.com/login/device"]);
});

test("when the connect ends, the code goes away and the row stops listening", async (t) => {
  const connect = pendingConnect();
  const { container, emitProgress, progressListeners } = await renderGithubRow(t, {
    status: DISCONNECTED,
    electronAPI: { connectorConnect: connect.connectorConnect },
  });
  await React.act(async () => click(button(container, "connectors.github.connect")));
  await emitProgress(PROGRESS);
  assert.equal(progressListeners.size, 1);

  await React.act(async () => connect.settle({ status: "failed", errorCode: "oauth_cancelled" }));

  assert.doesNotMatch(container.textContent, /WDJB-MJHT/);
  assert.equal(progressListeners.size, 0, "the progress listener was removed on unmount");
  // A cancelled connect is not an error.
  assert.doesNotMatch(container.textContent, /connectors\.github\.errors\./);
});

test("Cancel stops GitHub's connect, and the row reads as before Connect", async (t) => {
  const connect = pendingConnect();
  const { container, emitProgress, cancels } = await renderGithubRow(t, {
    status: DISCONNECTED,
    electronAPI: { connectorConnect: connect.connectorConnect },
  });
  await React.act(async () => click(button(container, "connectors.github.connect")));
  await emitProgress(PROGRESS);

  await React.act(async () => click(button(container, "connectors.github.deviceCode.cancel")));
  assert.deepEqual(cancels, ["github"]);
  // Main ends the connect as cancelled, which is not an error.
  await React.act(async () => connect.settle({ status: "failed", errorCode: "oauth_cancelled" }));

  assert.doesNotMatch(container.textContent, /WDJB-MJHT/);
  assert.doesNotMatch(container.textContent, /connectors\.github\.errors\./);
  assert.equal(hasButton(container, "connectors.github.connect"), true);
});

test("while GitHub's connect waits, Cancel is there before the code and Connect isn't offered again", async (t) => {
  const connect = pendingConnect();
  const { container, emitProgress, cancels } = await renderGithubRow(t, {
    status: DISCONNECTED,
    electronAPI: { connectorConnect: connect.connectorConnect },
  });
  await React.act(async () => click(button(container, "connectors.github.connect")));

  // Asking GitHub for a code can take a while: the user can already stop it.
  assert.equal(hasButton(container, "connectors.github.deviceCode.cancel"), true);
  // A second Connect would silently replace a code the user may have typed.
  assert.equal(hasButton(container, "connectors.github.connect"), false);
  await emitProgress(PROGRESS);
  assert.equal(hasButton(container, "connectors.github.connect"), false);

  await React.act(async () => click(button(container, "connectors.github.deviceCode.cancel")));
  assert.deepEqual(cancels, ["github"]);
  await React.act(async () => connect.settle({ status: "failed", errorCode: "oauth_cancelled" }));
  assert.equal(hasButton(container, "connectors.github.connect"), true);
  assert.deepEqual(connect.calls, ["github"]);
});

test("leaving Settings while the code is showing stops the connect, once", async (t) => {
  const connect = pendingConnect();
  const { container, emitProgress, unmount, cancels } = await renderGithubRow(t, {
    status: DISCONNECTED,
    electronAPI: { connectorConnect: connect.connectorConnect },
  });
  await React.act(async () => click(button(container, "connectors.github.connect")));
  await emitProgress(PROGRESS);

  await unmount();
  connect.settle({ status: "failed", errorCode: "oauth_cancelled" });
  await React.act(async () => {});

  assert.deepEqual(cancels, ["github"]);
});

test("leaving Settings after the connect finished stops nothing", async (t) => {
  const connect = pendingConnect();
  const { container, emitProgress, unmount, cancels } = await renderGithubRow(t, {
    status: DISCONNECTED,
    electronAPI: { connectorConnect: connect.connectorConnect },
  });
  await React.act(async () => click(button(container, "connectors.github.connect")));
  await emitProgress(PROGRESS);
  await React.act(async () =>
    connect.settle({ status: "connected", accountLabel: "@dana", workspaceLabel: "3" })
  );

  await unmount();

  assert.deepEqual(cancels, []);
});

test("leaving Settings mid-connect leaves other connectors' sign-ins alone", async (t) => {
  const connect = pendingConnect();
  const { container, unmount, cancels } = await renderGithubRow(t, {
    rowId: "gmail",
    status: {
      id: "gmail",
      connected: false,
      configured: true,
      accountLabel: null,
      workspaceLabel: null,
      needsReconnect: false,
    },
    electronAPI: { connectorConnect: connect.connectorConnect },
  });
  await React.act(async () => click(button(container, "connectors.gmail.connect")));

  await unmount();

  assert.deepEqual(connect.calls, ["gmail"]);
  assert.deepEqual(cancels, [], "the browser sign-in keeps going");
});

test("an expired code and a disabled device flow each get their own message", async (t) => {
  const answers = [
    { status: "failed", errorCode: "code_expired" },
    { status: "failed", errorCode: "device_flow_disabled" },
    { status: "failed", errorCode: "oauth_denied" },
  ];
  const { container } = await renderGithubRow(t, {
    status: DISCONNECTED,
    electronAPI: { connectorConnect: async () => answers.shift() },
  });

  await React.act(async () => click(button(container, "connectors.github.connect")));
  assert.match(container.textContent, /connectors\.github\.errors\.code_expired/);

  await React.act(async () => click(button(container, "connectors.github.connect")));
  assert.match(container.textContent, /connectors\.github\.errors\.device_flow_disabled/);

  await React.act(async () => click(button(container, "connectors.github.connect")));
  assert.match(container.textContent, /connectors\.github\.errors\.oauth_denied/);
  assert.doesNotMatch(container.textContent, /errors\.connect_failed/);
});

test("a connected login names the account and its repository count, with Manage repositories", async (t) => {
  const { container, opened } = await renderGithubRow(t, { status: GITHUB });

  assert.ok(
    container.textContent.includes(
      `connectors.github.connectedAs${JSON.stringify({ account: "@dana", repositories: "3" })}`
    ),
    "the summary names the login and the repository count"
  );
  assert.equal(hasButton(container, "connectors.github.repositories.choose"), false);
  await React.act(async () => click(button(container, "connectors.github.repositories.manage")));
  assert.deepEqual(opened, [GITHUB.manageUrl]);
  assert.equal(hasButton(container, "connectors.github.disconnect"), true);
});

test("with no repositories chosen yet, the row offers Choose repositories", async (t) => {
  const { container, opened } = await renderGithubRow(t, {
    status: { ...GITHUB, workspaceLabel: "0" },
  });
  // connectedAs_empty: "Connected as @dana · no repositories yet".
  assert.ok(
    container.textContent.includes(
      `connectors.github.connectedAs${JSON.stringify({ account: "@dana", context: "empty" })}`
    )
  );
  assert.equal(hasButton(container, "connectors.github.repositories.manage"), false);

  await React.act(async () => click(button(container, "connectors.github.repositories.choose")));

  assert.deepEqual(opened, [GITHUB.manageUrl]);
});

test("a repository count that couldn't be read shows just the login, never 'none yet'", async (t) => {
  const { container } = await renderGithubRow(t, { status: { ...GITHUB, workspaceLabel: null } });
  // connectedAs_unknown: "Connected as @dana".
  assert.ok(
    container.textContent.includes(
      `connectors.github.connectedAs${JSON.stringify({ account: "@dana", context: "unknown" })}`
    )
  );
  assert.doesNotMatch(container.textContent, /"repositories"|"empty"/);
  assert.equal(hasButton(container, "connectors.github.repositories.choose"), false);
  assert.equal(hasButton(container, "connectors.github.repositories.manage"), true);
});

test("Choose repositories arms a one-shot focus refresh; coming back with a count offers Manage repositories", async (t) => {
  let fetches = 0;
  const { container, dispatchFocus, opened } = await renderGithubRow(t, {
    status: { ...GITHUB, workspaceLabel: "0" },
    electronAPI: {
      // The row's own load and this button's own mount refresh each read the
      // status once before the user does anything; neither finds a
      // repository yet. Only the focus-triggered read (the 3rd) does.
      connectorStatus: async () => {
        fetches += 1;
        return [{ ...GITHUB, workspaceLabel: fetches <= 2 ? "0" : "2" }];
      },
    },
  });
  assert.equal(fetches, 2, "the row and the button each read the status once on mount");
  assert.equal(hasButton(container, "connectors.github.repositories.choose"), true);

  await React.act(async () => click(button(container, "connectors.github.repositories.choose")));
  assert.deepEqual(opened, [GITHUB.manageUrl]);
  // No refetch from the click itself: only coming back to the window does.
  assert.equal(fetches, 2);

  await dispatchFocus();

  assert.equal(fetches, 3);
  assert.equal(hasButton(container, "connectors.github.repositories.manage"), true);
  assert.equal(hasButton(container, "connectors.github.repositories.choose"), false);
});

test("the focus listener fires once and is removed on unmount too", async (t) => {
  const { container, dispatchFocus, focusListeners, unmount } = await renderGithubRow(t, {
    status: { ...GITHUB, workspaceLabel: "0" },
  });

  await React.act(async () => click(button(container, "connectors.github.repositories.choose")));
  assert.equal(focusListeners.size, 1);

  await dispatchFocus();
  assert.equal(focusListeners.size, 0, "a one-shot listener removes itself once fired");

  await React.act(async () => click(button(container, "connectors.github.repositories.choose")));
  assert.equal(focusListeners.size, 1);

  await unmount();
  assert.equal(focusListeners.size, 0, "unmounting removes a still-pending listener");
});

test("the three summaries read as intended in English", async () => {
  // tsx loads the ESM default export through CommonJS interop.
  const mod = await import("../../src/i18n.ts");
  const i18n = mod.default.default ?? mod.default;
  const t = i18n.getFixedT("en");
  const login = { account: "@dana" };
  assert.equal(
    t("connectors.github.connectedAs", { ...login, repositories: "3" }),
    "Connected as @dana · Repositories: 3"
  );
  assert.equal(
    t("connectors.github.connectedAs", { ...login, context: "empty" }),
    "Connected as @dana · no repositories yet"
  );
  assert.equal(
    t("connectors.github.connectedAs", { ...login, context: "unknown" }),
    "Connected as @dana"
  );
});

test("a build without an App slug shows no repositories button", async (t) => {
  const { container } = await renderGithubRow(t, { status: { ...GITHUB, manageUrl: undefined } });
  assert.equal(hasButton(container, "connectors.github.repositories.manage"), false);
  assert.equal(hasButton(container, "connectors.github.repositories.choose"), false);
  assert.equal(hasButton(container, "connectors.github.disconnect"), true);
});

test("with connectors turned off by the org, only Disconnect remains", async (t) => {
  const { container } = await renderGithubRow(t, { status: GITHUB, blockedByOrg: true });
  assert.equal(hasButton(container, "connectors.github.disconnect"), true);
  assert.equal(hasButton(container, "connectors.github.repositories.manage"), false);
});

test("a free plan keeps Disconnect for its login but can't manage repositories", async (t) => {
  const { container } = await renderGithubRow(t, { status: GITHUB, isPaid: false });
  assert.equal(hasButton(container, "connectors.github.disconnect"), true);
  assert.equal(hasButton(container, "connectors.github.repositories.manage"), false);
});

test("a login that needs reconnecting offers Reconnect and Disconnect", async (t) => {
  const { container } = await renderGithubRow(t, { status: { ...GITHUB, needsReconnect: true } });
  assert.match(container.textContent, /connectors\.github\.needsReconnect/);
  assert.equal(hasButton(container, "connectors.github.reconnect"), true);
  assert.equal(hasButton(container, "connectors.github.disconnect"), true);
});

test("after Disconnect, the row links to GitHub's authorizations page", async (t) => {
  const disconnects = [];
  let broadcast = () => {};
  const { container, opened, broadcastStatus } = await renderGithubRow(t, {
    status: GITHUB,
    electronAPI: {
      connectorDisconnect: async (connectorId) => {
        disconnects.push(connectorId);
        broadcast([DISCONNECTED]);
        return { status: "disconnected" };
      },
    },
  });
  broadcast = broadcastStatus;
  assert.equal(hasButton(container, "connectors.github.reviewOnGithub"), false);

  await React.act(async () => click(button(container, "connectors.github.disconnect")));

  assert.deepEqual(disconnects, ["github"]);
  assert.match(container.textContent, /connectors\.github\.disconnectedHint/);
  await React.act(async () => click(button(container, "connectors.github.reviewOnGithub")));
  assert.deepEqual(opened, ["https://github.com/settings/apps/authorizations"]);
});

test("a failed Disconnect doesn't point at GitHub's authorizations page", async (t) => {
  const { container } = await renderGithubRow(t, {
    status: GITHUB,
    electronAPI: {
      connectorDisconnect: async () => ({ status: "failed", errorCode: "disconnect_failed" }),
    },
  });

  await React.act(async () => click(button(container, "connectors.github.disconnect")));

  assert.match(container.textContent, /connectors\.github\.errors\.disconnect_failed/);
  assert.equal(hasButton(container, "connectors.github.reviewOnGithub"), false);
});

test("rows without the GitHub hooks are unchanged: Gmail shows no repositories button", async (t) => {
  const { container } = await renderGithubRow(t, {
    rowId: "gmail",
    status: {
      id: "gmail",
      connected: true,
      configured: true,
      accountLabel: "you@example.test",
      workspaceLabel: null,
      needsReconnect: false,
    },
  });
  assert.match(container.textContent, /connectors\.gmail\.connectedAs/);
  assert.doesNotMatch(container.textContent, /repositories/);
  assert.equal(hasButton(container, "connectors.gmail.disconnect"), true);
});
