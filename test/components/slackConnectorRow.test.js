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

// No i18next instance is initialized, so buttons render their keys.
function button(root, label) {
  const found = findElement(
    root,
    (element) => element.tagName === "BUTTON" && element.textContent === label
  );
  assert.ok(found, `button ${label} is rendered`);
  return found;
}

test("Connect runs the browser flow once and says why it failed", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const connects = [];
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        connectorConnect: async (connectorId) => {
          connects.push(connectorId);
          return { status: "failed", errorCode: "oauth_denied" };
        },
        connectorStatus: async () => [],
        onConnectorStatusChanged: () => () => {},
        connectorRecentActions: async () => [],
      },
    },
  });
  const container = installInteractiveDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-slack-connector-row-test-",
    mockModules: {
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
  const { SlackConnectorRow } = await vite.ssrLoadModule(
    "/components/connectors/SlackConnectorRow.tsx"
  );
  const { createRoot } = require("react-dom/client");
  root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(SlackConnectorRow, { isPaid: true, blockedByOrg: false, onUpgrade() {} })
    )
  );

  await React.act(async () => click(button(container, "connectors.slack.connect")));

  assert.deepEqual(connects, ["slack"]);
  assert.match(container.textContent, /connectors\.slack\.errors\.oauth_denied/);
});

// Shared setup for the Disconnect tests below: a connected row (so the
// Disconnect button renders), with `connectorDisconnect` swapped per test.
async function renderConnectedRow(t, { connectorDisconnect }) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        connectorDisconnect,
        connectorStatus: async () => [
          {
            id: "slack",
            connected: true,
            accountLabel: "chad",
            workspaceLabel: "Acme Test",
            needsReconnect: false,
          },
        ],
        onConnectorStatusChanged: () => () => {},
        connectorRecentActions: async () => [],
      },
    },
  });
  const container = installInteractiveDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-slack-connector-row-disconnect-test-",
    mockModules: {
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
  const { SlackConnectorRow } = await vite.ssrLoadModule(
    "/components/connectors/SlackConnectorRow.tsx"
  );
  const { createRoot } = require("react-dom/client");
  root = createRoot(container);
  await React.act(async () =>
    root.render(
      React.createElement(SlackConnectorRow, { isPaid: true, blockedByOrg: false, onUpgrade() {} })
    )
  );
  // Let the status load fired from the row's mount effect resolve and commit
  // (so `connected` flips true and the Disconnect button renders) before
  // interacting with the row.
  await React.act(async () => {});
  return container;
}

test("Disconnect shows the row's copy for an unavailable result", async (t) => {
  const disconnects = [];
  const container = await renderConnectedRow(t, {
    connectorDisconnect: async (connectorId) => {
      disconnects.push(connectorId);
      return { status: "unavailable", reason: "signed_out" };
    },
  });

  await React.act(async () => click(button(container, "connectors.slack.disconnect")));

  assert.deepEqual(disconnects, ["slack"]);
  assert.match(container.textContent, /connectors\.slack\.errors\.signed_out/);
});

test("a Disconnect click that succeeds shows no error", async (t) => {
  const disconnects = [];
  const container = await renderConnectedRow(t, {
    connectorDisconnect: async (connectorId) => {
      disconnects.push(connectorId);
      return { status: "disconnected" };
    },
  });

  await React.act(async () => click(button(container, "connectors.slack.disconnect")));

  assert.deepEqual(disconnects, ["slack"]);
  assert.doesNotMatch(container.textContent, /connectors\.slack\.errors\./);
});
