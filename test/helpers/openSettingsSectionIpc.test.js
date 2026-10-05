const test = require("node:test");
const assert = require("node:assert/strict");

test("only whitelisted sections are forwarded to the control panel", async () => {
  const { settingsSectionFromIpc } = await import("../../src/helpers/providerHttpErrors.js");
  assert.equal(settingsSectionFromIpc("speechToText"), "speechToText");
  assert.equal(settingsSectionFromIpc("llms"), "llms");
  assert.equal(settingsSectionFromIpc("account"), undefined);
  assert.equal(settingsSectionFromIpc({ toString: () => "llms" }), undefined);
});
