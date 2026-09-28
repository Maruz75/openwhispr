const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ipcHandlersSource = fs.readFileSync(
  path.join(__dirname, "../../src/helpers/ipcHandlers.js"),
  "utf8"
);

const cleanupHandler = ipcHandlersSource.match(
  /ipcMain\.handle\("cleanup-app", async \(event\) => \{([\s\S]*?)ipcMain\.handle\("update-hotkey"/
);

test("explicit device cleanup covers models, credentials, caches, and browser settings", () => {
  assert.ok(cleanupHandler, "cleanup-app handler is present");
  const source = cleanupHandler[1];

  for (const operation of [
    "deleteAllParakeetModels",
    "diarizationManager?.deleteModels",
    "modelManager.deleteAllModels",
    "environmentManager?.clearAllPersistedData",
    "tokenStore.clear",
    "clearStorageData",
    "clearCache",
    "setAutoStartEnabled(false)",
  ]) {
    assert.ok(source.includes(operation), `device cleanup includes ${operation}`);
  }

  for (const cacheName of ["embedding-models", "qdrant-data", "qdrant-data-dev", "yt-dlp"]) {
    assert.ok(source.includes(`"${cacheName}"`), `device cleanup removes ${cacheName}`);
  }

  assert.ok(
    source.includes('"account-scope-binding.json"'),
    "device cleanup removes the account scope binding"
  );

  assert.ok(source.includes('"connectors"'), "device cleanup removes encrypted connector logins");
});

// cleanup-app can't run outside Electron (it closes the database, clears
// sessions and relaunches), so this pins the order in its source. The
// manager finds the account to revoke for through the bearer token and the
// account binding, and records cancelled receipts in the database. After any
// of the steps below, disconnectAll() would revoke nothing, silently.
test("device cleanup revokes connector logins while the account and receipts they need still exist", () => {
  assert.ok(cleanupHandler, "cleanup-app handler is present");
  const source = cleanupHandler[1];
  const revoke = source.indexOf("this.connectorManager?.disconnectAll()");
  assert.ok(
    revoke >= 0,
    "device cleanup revokes connector logins (Slack, Gmail) at their providers"
  );

  for (const later of [
    "this.databaseManager?.db?.close()",
    "tokenStore.clear()",
    '"account-scope-binding.json"',
    'for (const directoryName of ["bin", "llama-cpp", "connectors"])',
  ]) {
    const at = source.indexOf(later);
    assert.ok(at >= 0, `device cleanup still contains ${later}`);
    assert.ok(revoke < at, `connector logins are revoked before ${later}`);
  }
});
