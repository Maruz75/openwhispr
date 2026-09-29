const test = require("node:test");
const assert = require("node:assert/strict");

const WhisperServerManager = require("../../src/helpers/whisperServer");

// A Unix signal death reports no exit code, so a whisper-server killed by SIGILL
// at startup used to fail with no detail at all (#2356).
test("a startup death names the signal when the server printed nothing", async () => {
  const manager = new WhisperServerManager();

  await assert.rejects(
    manager.waitForReady(() => ({ stderr: "", exitCode: null, signal: "SIGSEGV" }), 1000),
    { message: "whisper-server process died during startup: signal: SIGSEGV" }
  );
  await assert.rejects(
    manager.waitForReady(() => ({ stderr: "", exitCode: 3221225501, signal: null }), 1000),
    { message: "whisper-server process died during startup: exit code: 3221225501" }
  );
  await assert.rejects(
    manager.waitForReady(
      () => ({ stderr: "ggml_abort\n", exitCode: null, signal: "SIGABRT" }),
      1000
    ),
    { message: "whisper-server process died during startup: ggml_abort" }
  );
});
