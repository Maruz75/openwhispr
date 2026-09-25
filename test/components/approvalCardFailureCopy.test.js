const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// Kept out of approvalCard.test.js: this test initializes i18next, and
// i18next is one shared SSR module instance, so running it in the same file
// as approvalCard.test.js's raw-key tests would make their outcome depend on
// test order.
test("a failed card explains a known Slack error, and falls back to the connector's message", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-approval-card-errors-test-",
    mockModules: {
      "/ui/button": `
        import React from "react";
        export function Button(props) { return React.createElement("button", props); }
      `,
    },
  });
  const [{ default: i18next }, { initReactI18next }] = await Promise.all([
    vite.ssrLoadModule("i18next"),
    vite.ssrLoadModule("react-i18next"),
  ]);
  if (!i18next.isInitialized) {
    const translation = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../src/locales/en/translation.json"), "utf8")
    );
    await i18next.use(initReactI18next).init({
      lng: "en",
      resources: { en: { translation } },
      interpolation: { escapeValue: false },
    });
  }
  const { ApprovalCard } = await vite.ssrLoadModule("/components/chat/ApprovalCard.tsx");
  const failed = (errorCode, message) => ({
    key: "m1::call-1",
    messageId: "m1",
    toolCallId: "call-1",
    actionId: "a1",
    connectorId: "slack",
    preview: {
      verbKey: "slackPost",
      destinationLabel: "#eng",
      accountLabel: "chad",
      workspaceLabel: "Acme",
      body: "hi",
    },
    draft: { body: "hi" },
    state: "failed",
    errorCode,
    message,
  });

  const known = renderToStaticMarkup(
    createElement(ApprovalCard, { entry: failed("not_in_channel", "raw") })
  );
  assert.match(known, /Post to #eng/);
  assert.match(known, /not a member of #eng/);
  assert.doesNotMatch(known, /raw/);

  const unknown = renderToStaticMarkup(
    createElement(ApprovalCard, { entry: failed("weird_code", "Slack said no") })
  );
  assert.match(unknown, /Slack said no/);
});
