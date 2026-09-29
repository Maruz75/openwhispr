const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NOW,
  FIXTURES,
  BINDING,
  fakeLinearFetch,
  gql,
  gqlError,
  httpStatus,
  offline,
} = require("./linearFixtures");

const loadTeams = () => import("../../../src/helpers/connectors/linearTeams.js");
const loadApi = () => import("../../../src/helpers/connectors/linearApi.js");

const GRAPHQL = "/graphql";
const TOKEN = "access-1";
const ENG = { id: "team-eng", key: "ENG", name: "Engineering" };
const DES = { id: "team-des", key: "DES", name: "Design" };

const teamsReply = (nodes, hasNextPage = false) =>
  gql({ teams: { nodes, pageInfo: { hasNextPage } } });
const projectsReply = (nodes, hasNextPage = false) =>
  gql({ team: { projects: { nodes, pageInfo: { hasNextPage } } } });

async function setup({ teams = [gql(FIXTURES.teams)], projects = [gql(FIXTURES.projects)] } = {}) {
  const [{ createLinearTeams }, { createLinearApi }] = await Promise.all([loadTeams(), loadApi()]);
  const linear = fakeLinearFetch({
    [GRAPHQL]: { LinearTeams: teams, LinearTeamProjects: projects },
  });
  let clock = NOW;
  const directory = createLinearTeams({
    api: createLinearApi({ fetchImpl: linear.fetchImpl, sleep: async () => {} }),
    now: () => clock,
  });
  const advance = (ms) => {
    clock += ms;
  };
  const count = (operation) => linear.calls.filter((call) => call.operation === operation).length;
  return { directory, linear, advance, count };
}

test("list reads the workspace's teams with the login's token", async () => {
  const { directory, linear } = await setup();

  assert.deepEqual(await directory.list(BINDING, TOKEN), {
    ok: true,
    teams: [ENG, DES],
    truncated: false,
  });
  assert.equal(linear.calls[0].operation, "LinearTeams");
  assert.equal(linear.calls[0].authorization, "Bearer access-1");
});

test("list drops malformed teams and reports a cut-off list", async () => {
  const { directory } = await setup({
    teams: [
      teamsReply(
        [ENG, { id: "team-x", key: "", name: "No key" }, { key: "OPS", name: "No id" }, null],
        true
      ),
    ],
  });

  assert.deepEqual(await directory.list(BINDING, TOKEN), {
    ok: true,
    teams: [ENG],
    truncated: true,
  });
});

test("teams are cached for 10 minutes per login, and a new login reads them again", async () => {
  const { CACHE_TTL_MS } = await loadTeams();
  assert.equal(CACHE_TTL_MS, 10 * 60 * 1000);
  const { directory, advance, count } = await setup();

  await directory.list(BINDING, TOKEN);
  await directory.resolveTeam(BINDING, TOKEN, "ENG");
  advance(CACHE_TTL_MS - 1);
  await directory.list(BINDING, TOKEN);
  assert.equal(count("LinearTeams"), 1, "within 10 minutes");

  advance(1);
  await directory.list(BINDING, TOKEN);
  assert.equal(count("LinearTeams"), 2, "expired at 10 minutes");

  // A reconnect is a new generation; another OpenWhispr account is its own.
  await directory.list({ ...BINDING, generation: 2 }, TOKEN);
  await directory.list({ ...BINDING, ownerAccountId: "acct-2" }, TOKEN);
  assert.equal(count("LinearTeams"), 4);
});

test("a failed read is passed on and never cached", async () => {
  const { directory, count } = await setup({
    teams: [offline(), httpStatus(503), gqlError("FORBIDDEN"), gql(FIXTURES.teams)],
  });

  assert.deepEqual(await directory.list(BINDING, TOKEN), {
    ok: false,
    outcome: "failed",
    errorCode: "ENOTFOUND",
  });
  assert.deepEqual(await directory.resolveTeam(BINDING, TOKEN, "ENG"), {
    ok: false,
    outcome: "unknown",
    errorCode: "http_503",
  });
  assert.deepEqual(await directory.list(BINDING, TOKEN), {
    ok: false,
    outcome: "failed",
    errorCode: "forbidden",
  });
  assert.equal((await directory.list(BINDING, TOKEN)).ok, true);
  assert.equal(count("LinearTeams"), 4);
});

test("an answer without a team list is bad_response", async () => {
  const { directory } = await setup({ teams: [gql({ teams: null })] });
  assert.deepEqual(await directory.list(BINDING, TOKEN), {
    ok: false,
    outcome: "unknown",
    errorCode: "bad_response",
  });
});

test("clear forgets one login's teams and projects, and only that login's", async () => {
  const { directory, count } = await setup();
  const other = { ...BINDING, ownerAccountId: "acct-2" };
  await directory.list(BINDING, TOKEN);
  await directory.list(other, TOKEN);
  await directory.resolveProject(BINDING, TOKEN, "team-eng", "Q4 launch");

  directory.clear(BINDING);
  await directory.list(BINDING, TOKEN);
  await directory.list(other, TOKEN);
  await directory.resolveProject(BINDING, TOKEN, "team-eng", "Q4 launch");
  assert.equal(count("LinearTeams"), 3);
  assert.equal(count("LinearTeamProjects"), 2);

  directory.clear();
  await directory.list(other, TOKEN);
  assert.equal(count("LinearTeams"), 4);
});

test("a workspace with one team uses it without asking", async () => {
  for (const input of [undefined, null, "", "   "]) {
    const { directory } = await setup({ teams: [teamsReply([ENG])] });
    assert.deepEqual(await directory.resolveTeam(BINDING, TOKEN, input), { ok: true, team: ENG });
  }
});

test("with several teams and none named, the user is asked, with every team listed as KEY · Name", async () => {
  const { directory } = await setup();

  assert.deepEqual(await directory.resolveTeam(BINDING, TOKEN, undefined), {
    ok: false,
    clarification: {
      message: "Which Linear team should this go to? Ask the user.",
      candidates: ["ENG · Engineering", "DES · Design"],
    },
  });
});

test("a cut-off team list is never taken as the only team", async () => {
  const { directory } = await setup({ teams: [teamsReply([ENG], true)] });

  const result = await directory.resolveTeam(BINDING, TOKEN, undefined);

  assert.equal(result.ok, false);
  assert.deepEqual(result.clarification.candidates, ["ENG · Engineering"]);
});

test("a login that sees no team gets a question with no candidates", async () => {
  const { directory } = await setup({ teams: [teamsReply([])] });
  assert.deepEqual(await directory.resolveTeam(BINDING, TOKEN, undefined), {
    ok: false,
    clarification: {
      message: "This Linear login can't see any team to create an issue in.",
      candidates: [],
    },
  });
});

test("a team resolves by key or name, in any case, and by a prefix only one team has", async () => {
  const { directory } = await setup();
  for (const [input, team] of [
    ["ENG", ENG],
    ["eng", ENG],
    ["Engineering", ENG],
    ["engineering", ENG],
    ["  Design ", DES],
    ["engin", ENG],
    ["des", DES],
  ]) {
    assert.deepEqual(await directory.resolveTeam(BINDING, TOKEN, input), { ok: true, team }, input);
  }
});

test("an exact name wins over a longer name that starts the same way", async () => {
  const design = { id: "team-d", key: "DSG", name: "Design" };
  const systems = { id: "team-ds", key: "DSY", name: "Design Systems" };
  const { directory } = await setup({ teams: [teamsReply([design, systems])] });

  assert.deepEqual(await directory.resolveTeam(BINDING, TOKEN, "Design"), {
    ok: true,
    team: design,
  });
  assert.deepEqual(await directory.resolveTeam(BINDING, TOKEN, "design sys"), {
    ok: true,
    team: systems,
  });
});

test("names that match more than one team always ask, listing the candidates", async () => {
  const cases = [
    // A key and a name that read the same.
    [
      [
        { id: "team-en", key: "EN", name: "Eng" },
        { id: "team-eng", key: "ENG", name: "Engineering" },
      ],
      "eng",
      ["EN · Eng", "ENG · Engineering"],
    ],
    // Two teams share a prefix.
    [
      [
        { id: "team-be", key: "BE", name: "Eng Backend" },
        { id: "team-fe", key: "FE", name: "Eng Frontend" },
      ],
      "Eng",
      ["BE · Eng Backend", "FE · Eng Frontend"],
    ],
    // Punctuation and spaces don't tell names apart.
    [
      [
        { id: "team-1", key: "PL", name: "Platform-Ops" },
        { id: "team-2", key: "PO", name: "platform ops" },
      ],
      "PlatformOps",
      ["PL · Platform-Ops", "PO · platform ops"],
    ],
  ];
  for (const [teams, input, candidates] of cases) {
    const { directory } = await setup({ teams: [teamsReply(teams)] });
    assert.deepEqual(
      await directory.resolveTeam(BINDING, TOKEN, input),
      {
        ok: false,
        clarification: {
          message: `More than one Linear team matches "${input}". Ask the user which one.`,
          candidates,
        },
      },
      input
    );
  }
});

test("a team no one has asks, listing every team", async () => {
  const { directory } = await setup();

  assert.deepEqual(await directory.resolveTeam(BINDING, TOKEN, "Marketing"), {
    ok: false,
    clarification: {
      message: 'No Linear team matches "Marketing". Ask the user which team to use.',
      candidates: ["ENG · Engineering", "DES · Design"],
    },
  });
});

test("a cut-off team list matches exact names only", async () => {
  const { directory } = await setup({ teams: [teamsReply([ENG, DES], true)] });

  assert.deepEqual(await directory.resolveTeam(BINDING, TOKEN, "ENG"), { ok: true, team: ENG });
  const loose = await directory.resolveTeam(BINDING, TOKEN, "engin");
  assert.equal(loose.ok, false);
  assert.match(loose.clarification.message, /^No Linear team matches/);
});

test("a question lists at most 20 teams, and quotes at most 100 characters of the name", async () => {
  const teams = Array.from({ length: 30 }, (_, index) => ({
    id: `team-${index}`,
    key: `T${index}`,
    name: `Team ${index}`,
  }));
  const { directory } = await setup({ teams: [teamsReply(teams)] });

  const unnamed = await directory.resolveTeam(BINDING, TOKEN, undefined);
  assert.equal(unnamed.clarification.candidates.length, 20);
  assert.equal(unnamed.clarification.candidates[0], "T0 · Team 0");

  const long = await directory.resolveTeam(BINDING, TOKEN, "x".repeat(500));
  assert.ok(long.clarification.message.includes(`"${"x".repeat(100)}"`));
  assert.ok(!long.clarification.message.includes("x".repeat(101)));
});

test("a project resolves by name within the team, cached per team", async () => {
  const { directory, linear, count } = await setup();

  assert.deepEqual(await directory.resolveProject(BINDING, TOKEN, "team-eng", "q4 LAUNCH"), {
    ok: true,
    project: { id: "proj-q4", name: "Q4 launch" },
  });
  assert.deepEqual(await directory.resolveProject(BINDING, TOKEN, "team-eng", "Onboard"), {
    ok: true,
    project: { id: "proj-onb", name: "Onboarding" },
  });
  assert.equal(count("LinearTeamProjects"), 1);
  assert.deepEqual(linear.calls[0].variables, { teamId: "team-eng" });

  await directory.resolveProject(BINDING, TOKEN, "team-des", "Q4 launch");
  assert.equal(count("LinearTeamProjects"), 2, "another team is its own list");
});

test("no project named means no project and nothing dropped, with no request", async () => {
  const { directory, linear } = await setup();
  for (const input of [undefined, null, "", "  "]) {
    assert.deepEqual(await directory.resolveProject(BINDING, TOKEN, "team-eng", input), {
      ok: true,
      project: null,
      dropped: null,
    });
  }
  assert.deepEqual(linear.calls, []);
});

test("an unknown project is dropped and reported, not guessed", async () => {
  const { directory } = await setup();

  assert.deepEqual(await directory.resolveProject(BINDING, TOKEN, "team-eng", " Q5 launch "), {
    ok: true,
    project: null,
    dropped: "Q5 launch",
  });

  const noTeam = await setup({ projects: [gql({ team: null })] });
  assert.deepEqual(await noTeam.directory.resolveProject(BINDING, TOKEN, "team-x", "Q4 launch"), {
    ok: true,
    project: null,
    dropped: "Q4 launch",
  });
});

test("an ambiguous project asks, listing the candidates", async () => {
  const { directory } = await setup({
    projects: [
      projectsReply([
        { id: "proj-1", name: "Mobile app" },
        { id: "proj-2", name: "Mobile web" },
        { id: "proj-3", name: "Desktop" },
      ]),
    ],
  });

  assert.deepEqual(await directory.resolveProject(BINDING, TOKEN, "team-eng", "mobile"), {
    ok: false,
    clarification: {
      message: 'More than one Linear project matches "mobile". Ask the user which one.',
      candidates: ["Mobile app", "Mobile web"],
    },
  });
});

test("a cut-off project list matches exact names only, and drops the rest", async () => {
  const { directory } = await setup({
    projects: [projectsReply([{ id: "proj-q4", name: "Q4 launch" }], true)],
  });

  assert.deepEqual(await directory.resolveProject(BINDING, TOKEN, "team-eng", "Q4 launch"), {
    ok: true,
    project: { id: "proj-q4", name: "Q4 launch" },
  });
  assert.deepEqual(await directory.resolveProject(BINDING, TOKEN, "team-eng", "Q4"), {
    ok: true,
    project: null,
    dropped: "Q4",
  });
});

test("a project list that can't be read is passed on, never treated as 'not found'", async () => {
  const { directory, count } = await setup({
    projects: [httpStatus(500), gql({ team: { projects: null } }), gql(FIXTURES.projects)],
  });

  assert.deepEqual(await directory.resolveProject(BINDING, TOKEN, "team-eng", "Q4 launch"), {
    ok: false,
    outcome: "unknown",
    errorCode: "http_500",
  });
  assert.deepEqual(await directory.resolveProject(BINDING, TOKEN, "team-eng", "Q4 launch"), {
    ok: false,
    outcome: "unknown",
    errorCode: "bad_response",
  });
  assert.equal((await directory.resolveProject(BINDING, TOKEN, "team-eng", "Q4 launch")).ok, true);
  assert.equal(count("LinearTeamProjects"), 3);
});
