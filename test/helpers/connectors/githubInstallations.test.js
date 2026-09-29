const test = require("node:test");
const assert = require("node:assert/strict");
const { NOW, BINDING, fakeGithubFetch, json } = require("./githubFixtures");

const loadInstallations = () => import("../../../src/helpers/connectors/githubInstallations.js");
const loadApi = () => import("../../../src/helpers/connectors/githubApi.js");

const INSTALLATIONS = "GET /user/installations";
const reposOf = (id) => `GET /user/installations/${id}/repositories`;
const TOKEN = "ghu-1";

function repo(fullName, updatedAt, extra = {}) {
  const [owner, name] = fullName.split("/");
  return {
    id: fullName.length,
    name,
    full_name: fullName,
    owner: { login: owner, id: 1 },
    private: false,
    updated_at: updatedAt,
    ...extra,
  };
}

const installation = (id, login) => ({ id, account: { login }, repository_selection: "selected" });
const next = (path, page) => ({
  link: `<https://api.github.com${path}?per_page=100&page=${page}>; rel="next", <https://api.github.com${path}?per_page=100&page=9>; rel="last"`,
});
const installationsPage = (installations, headers = {}) =>
  json({ total_count: installations.length, installations }, 200, headers);
const reposPage = (repositories, headers = {}) =>
  json({ total_count: repositories.length, repositories }, 200, headers);

const ACME_API = repo("acme/api", "2026-09-27T10:00:00Z", { private: true });
const ACME_WEB = repo("acme/web", "2026-09-20T10:00:00Z");
// Issues turned off: a 410 on its issues means that, not a deleted issue.
const DANA_API = repo("dana/api", "2026-09-25T10:00:00Z", { has_issues: false });
const DANA_NOTES = repo("dana/notes", "2026-09-28T09:00:00Z");

// Two installations (an org and the user), the first split over two pages,
// and the org's repositories split over two pages.
function twoInstallations() {
  return {
    [INSTALLATIONS]: [
      installationsPage([installation(1, "acme")], next("/user/installations", 2)),
      installationsPage([installation(2, "dana")]),
    ],
    [reposOf(1)]: [
      reposPage([ACME_WEB], next("/user/installations/1/repositories", 2)),
      reposPage([ACME_API]),
    ],
    [reposOf(2)]: [reposPage([DANA_API, DANA_NOTES])],
  };
}

// One installation with one page: every read is exactly two requests.
function oneInstallation() {
  return {
    [INSTALLATIONS]: [installationsPage([installation(2, "dana")])],
    [reposOf(2)]: [reposPage([DANA_API, DANA_NOTES])],
  };
}

async function setup(script, { clock = { now: NOW } } = {}) {
  const [{ createGithubInstallations }, { createGithubApi }] = await Promise.all([
    loadInstallations(),
    loadApi(),
  ]);
  const github = fakeGithubFetch(script);
  const api = createGithubApi({
    fetchImpl: github.fetchImpl,
    sleep: async () => {},
    now: () => clock.now,
  });
  const installations = createGithubInstallations({ api, now: () => clock.now });
  return { installations, github, clock };
}

test("lists every installed repository across installations and pages, most recently updated first", async () => {
  const { installations, github } = await setup(twoInstallations());

  const listed = await installations.list(BINDING, TOKEN);

  assert.equal(listed.ok, true);
  assert.equal(listed.installationCount, 2);
  assert.deepEqual(listed.repos, [
    {
      owner: "dana",
      name: "notes",
      fullName: "dana/notes",
      private: false,
      hasIssues: true,
      updatedAt: "2026-09-28T09:00:00Z",
    },
    {
      owner: "acme",
      name: "api",
      fullName: "acme/api",
      private: true,
      hasIssues: true,
      updatedAt: "2026-09-27T10:00:00Z",
    },
    {
      owner: "dana",
      name: "api",
      fullName: "dana/api",
      private: false,
      hasIssues: false,
      updatedAt: "2026-09-25T10:00:00Z",
    },
    {
      owner: "acme",
      name: "web",
      fullName: "acme/web",
      private: false,
      hasIssues: true,
      updatedAt: "2026-09-20T10:00:00Z",
    },
  ]);
  assert.deepEqual(
    github.calls.map((call) => [call.path, call.query.page ?? "1"]),
    [
      ["/user/installations", "1"],
      ["/user/installations", "2"],
      ["/user/installations/1/repositories", "1"],
      ["/user/installations/1/repositories", "2"],
      ["/user/installations/2/repositories", "1"],
    ]
  );
  for (const call of github.calls) {
    assert.equal(call.query.per_page, "100");
    assert.equal(call.authorization, "Bearer ghu-1");
  }
});

test("repository entries without an owner, name or full name are skipped", async () => {
  const { installations } = await setup({
    [INSTALLATIONS]: [installationsPage([installation(1, "acme"), { account: {} }])],
    [reposOf(1)]: [reposPage([ACME_API, { name: "ghost" }, { ...ACME_WEB, owner: null }, null])],
  });

  const listed = await installations.list(BINDING, TOKEN);

  assert.deepEqual(
    listed.repos.map((entry) => entry.fullName),
    ["acme/api"]
  );
});

test("the list is kept for 60 seconds per login, then read again", async () => {
  const { installations, github, clock } = await setup(oneInstallation());
  await installations.list(BINDING, TOKEN);
  assert.equal(github.calls.length, 2);

  clock.now = NOW + 60 * 1000 - 1;
  assert.equal((await installations.list(BINDING, TOKEN)).repos.length, 2);
  assert.equal(github.calls.length, 2);

  clock.now = NOW + 60 * 1000;
  await installations.list(BINDING, TOKEN);
  assert.equal(github.calls.length, 4);
});

test("another login, or a cleared cache, reads the list again", async () => {
  const { installations, github } = await setup(oneInstallation());
  await installations.list(BINDING, TOKEN);
  assert.equal(github.calls.length, 2);

  // A reconnect gives the slot a new generation: never the old login's list.
  await installations.list({ ...BINDING, generation: 2 }, TOKEN);
  assert.equal(github.calls.length, 4);
  await installations.list({ ...BINDING, ownerAccountId: "acct-2" }, TOKEN);
  assert.equal(github.calls.length, 6);

  installations.clear(BINDING);
  await installations.list(BINDING, TOKEN);
  assert.equal(github.calls.length, 8);
});

test("a failed read is reported, never cached, and never half a list", async () => {
  const outage = await setup({
    [INSTALLATIONS]: [json({ message: "Server Error" }, 502), installationsPage([])],
  });
  const failed = await outage.installations.list(BINDING, TOKEN);
  assert.equal(failed.ok, false);
  assert.equal(failed.outcome, "unknown");
  assert.equal(failed.errorCode, "http_502");
  assert.deepEqual(await outage.installations.list(BINDING, TOKEN), {
    ok: true,
    repos: [],
    installationCount: 0,
  });

  const partial = await setup({
    [INSTALLATIONS]: [installationsPage([installation(1, "acme"), installation(2, "dana")])],
    [reposOf(1)]: [reposPage([ACME_API])],
    [reposOf(2)]: [json({ message: "Bad credentials" }, 401)],
  });
  const listed = await partial.installations.list(BINDING, TOKEN);
  assert.equal(listed.ok, false);
  assert.equal(listed.errorCode, "unauthorized");
});

test("a read the caller gave up on reports a timeout and is never cached, even when it lands", async () => {
  const [{ createGithubInstallations }, { createGithubApi }] = await Promise.all([
    loadInstallations(),
    loadApi(),
  ]);
  const github = fakeGithubFetch(oneInstallation());
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  // GitHub answers only once the test lets it, after the caller gave up.
  const api = createGithubApi({
    fetchImpl: async (url, init) => {
      await held;
      return github.fetchImpl(url, init);
    },
    sleep: async () => {},
    now: () => NOW,
  });
  const installations = createGithubInstallations({ api, now: () => NOW });
  const controller = new AbortController();

  const pending = installations.list(BINDING, TOKEN, { signal: controller.signal });
  controller.abort();
  assert.deepEqual(await pending, { ok: false, outcome: "unknown", errorCode: "timeout" });

  release();
  await new Promise((resolve) => setImmediate(resolve));
  const fresh = await installations.list(BINDING, TOKEN);
  assert.equal(fresh.repos.length, 2);
  // The late answer wasn't kept: the next list read GitHub again.
  assert.equal(github.calls.filter((call) => call.path === "/user/installations").length, 2);
});

test("a repo is resolved by owner/name in any case, or by a bare name only one repo has", async () => {
  const { installations } = await setup(twoInstallations());

  assert.deepEqual(await installations.resolveRepo(BINDING, TOKEN, "ACME/Api"), {
    ok: true,
    repo: {
      owner: "acme",
      name: "api",
      fullName: "acme/api",
      private: true,
      hasIssues: true,
      updatedAt: "2026-09-27T10:00:00Z",
    },
  });
  assert.equal(
    (await installations.resolveRepo(BINDING, TOKEN, " notes ")).repo.fullName,
    "dana/notes"
  );
  assert.equal((await installations.resolveRepo(BINDING, TOKEN, "WEB")).repo.fullName, "acme/web");
});

test("a bare name two installed repos share is a question listing owner/name", async () => {
  const { installations } = await setup(twoInstallations());

  assert.deepEqual(await installations.resolveRepo(BINDING, TOKEN, "api"), {
    ok: false,
    clarification: {
      message: "Several installed repositories are named api. Ask the user which one.",
      candidates: ["acme/api", "dana/api"],
    },
  });
});

test("with no repo named, one installed repo is used and several are a question", async () => {
  const single = await setup({
    [INSTALLATIONS]: [installationsPage([installation(2, "dana")])],
    [reposOf(2)]: [reposPage([DANA_NOTES])],
  });
  assert.equal(
    (await single.installations.resolveRepo(BINDING, TOKEN)).repo.fullName,
    "dana/notes"
  );
  assert.equal(
    (await single.installations.resolveRepo(BINDING, TOKEN, "  ")).repo.fullName,
    "dana/notes"
  );

  const several = await setup(twoInstallations());
  assert.deepEqual(await several.installations.resolveRepo(BINDING, TOKEN, undefined), {
    ok: false,
    clarification: {
      message: "Ask the user which repository to use.",
      candidates: ["dana/notes", "acme/api", "dana/api", "acme/web"],
    },
  });
});

test("a repo the App isn't installed on is named in the refusal; none installed is its own refusal", async () => {
  const { installations } = await setup(twoInstallations());
  assert.deepEqual(await installations.resolveRepo(BINDING, TOKEN, "acme/secret"), {
    ok: false,
    errorCode: "not_installed",
    message: "The OpenWhispr GitHub App isn't installed on acme/secret.",
  });
  assert.equal(
    (await installations.resolveRepo(BINDING, TOKEN, "infra")).errorCode,
    "not_installed"
  );

  const none = await setup({ [INSTALLATIONS]: [installationsPage([])] });
  for (const input of [undefined, "acme/api", "api"]) {
    const refused = await none.installations.resolveRepo(BINDING, TOKEN, input);
    assert.equal(refused.errorCode, "no_repositories", String(input));
    assert.match(refused.message, /Settings → Integrations → Connectors/);
  }
});

test("resolving a repo passes a failed list read through", async () => {
  const { installations } = await setup({ [INSTALLATIONS]: [json({ message: "x" }, 401)] });

  const refused = await installations.resolveRepo(BINDING, TOKEN, "acme/api");

  assert.equal(refused.ok, false);
  assert.equal(refused.outcome, "failed");
  assert.equal(refused.errorCode, "unauthorized");
});
