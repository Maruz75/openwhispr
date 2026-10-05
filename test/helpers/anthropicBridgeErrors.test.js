const test = require("node:test");
const assert = require("node:assert/strict");

test("an Anthropic HTTP failure resolves with classified IPC fields", async () => {
  const { anthropicFailure } = await import("../../src/helpers/anthropicBridgeErrors.js");
  const result = anthropicFailure({
    status: 400,
    body: '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
    headers: { "request-id": "req_9" },
    model: "claude-sonnet-5",
  });
  assert.equal(result.success, false);
  assert.equal(result.code, "PROVIDER_QUOTA_EXHAUSTED");
  assert.equal(result.messageKey, "providerErrors.quotaExhausted");
  assert.deepEqual(result.messageParams, { provider: "Anthropic" });
  assert.equal(result.settingsTarget, "llms");
  assert.equal(result.status, 400);
  assert.equal(result.technicalDetails.requestId, "req_9");
  assert.equal(result.error, "Your Anthropic account is out of credit.");
});

test("a message-less error object no longer prints [object Object]", async () => {
  const { anthropicFailure } = await import("../../src/helpers/anthropicBridgeErrors.js");
  const result = anthropicFailure({ status: 500, body: '{"error":{}}', model: "m" });
  assert.equal(result.error.includes("[object Object]"), false);
  assert.equal(result.code, "PROVIDER_UNAVAILABLE");
});
