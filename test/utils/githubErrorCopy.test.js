const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LOCALES = ["ar", "de", "en", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"];
// Foundation spec §5.5: the codes every connector must word itself.
const REQUIRED = [
  "reconnect_needed",
  "network",
  "rate_limited",
  "connection_changed",
  "credential_save_failed",
  "generic",
];
// Every other code GitHub's connector and tools return.
const GITHUB_CODES = [
  ...REQUIRED,
  "not_installed",
  "no_repositories",
  "forbidden",
  "not_found",
  "issues_disabled",
  "invalid",
  "locked",
  "invalid_reference",
  "too_long",
  "not_configured",
];

const connectorsCopy = (locale) =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, `../../src/locales/${locale}/translation.json`), "utf8")
  ).connectors;

let connectorErrorText;
let i18n;

test.before(async () => {
  ({ connectorErrorText } = await import("../../src/utils/connectorErrorCopy.ts"));
  // tsx loads the ESM default export through CommonJS interop.
  const mod = await import("../../src/i18n.ts");
  i18n = mod.default.default ?? mod.default;
});

test("GitHub's required codes read GitHub's own copy on the card and the tool step, in every locale", () => {
  for (const locale of LOCALES) {
    const t = i18n.getFixedT(locale);
    const copy = connectorsCopy(locale);
    for (const scope of ["approval", "toolStatus"]) {
      for (const code of REQUIRED) {
        const own = copy[scope].errors.github?.[code];
        assert.equal(typeof own, "string", `${locale} ${scope}.errors.github.${code} exists`);
        const shown = connectorErrorText(t, scope, "github", code);
        assert.equal(shown, own, `${locale} ${scope} ${code} resolves to GitHub's copy`);
        assert.notEqual(
          shown,
          connectorErrorText(t, scope, "", code),
          `${locale} ${scope} ${code} is not the shared copy`
        );
        assert.doesNotMatch(shown, /Slack/, `${locale} ${scope} ${code}`);
      }
    }
  }
});

test("a transport code or an unlisted HTTP status still reads as GitHub's copy", () => {
  const t = i18n.getFixedT("en");
  const copy = connectorsCopy("en");
  assert.equal(
    connectorErrorText(t, "approval", "github", "ENOTFOUND"),
    copy.approval.errors.github.network
  );
  assert.equal(
    connectorErrorText(t, "toolStatus", "github", "timeout"),
    copy.toolStatus.errors.github.network
  );
  assert.equal(
    connectorErrorText(t, "approval", "github", "http_418"),
    copy.approval.errors.github.generic
  );
  assert.equal(
    connectorErrorText(t, "toolStatus", "github", "query_failed"),
    copy.toolStatus.errors.github.generic
  );
});

test("every code GitHub returns has its own copy on both surfaces, in English", () => {
  const copy = connectorsCopy("en");
  for (const scope of ["approval", "toolStatus"]) {
    assert.deepEqual(
      Object.keys(copy[scope].errors.github).sort(),
      [...GITHUB_CODES].sort(),
      scope
    );
  }
});

test("GitHub cards and receipts name GitHub", () => {
  const copy = connectorsCopy("en");
  assert.equal(copy.approval.openIn.github, "Open in GitHub");
  assert.match(copy.toolStatus.unknownSent.github, /\{\{destination\}\}/);
  assert.match(copy.approval.github.notes.mentions, /\{\{mentions\}\}/);
  assert.match(copy.recent.actions.github_create_issue, /\{\{destination\}\}/);
  assert.match(copy.recent.actions.github_comment, /\{\{destination\}\}/);
  assert.equal(typeof copy.recent.unlabeledActions.github_create_issue, "string");
  assert.equal(typeof copy.recent.unlabeledActions.github_comment, "string");
});
