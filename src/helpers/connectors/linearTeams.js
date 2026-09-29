// A Linear workspace's teams and, on demand, a team's projects, cached for
// 10 minutes per login, and resolved from what the user said with the shared
// targetResolution rule: exact, then case-insensitive, then prefix. Two
// matches at one stage are always a question, never a guess.
const { resolveTarget } = require("./targetResolution");

const CACHE_TTL_MS = 10 * 60 * 1000;
// Linear's largest page. A workspace with more teams (or a team with more
// projects) is resolved by exact name only, since a looser match could be on
// the page that wasn't read.
const PAGE_SIZE = 250;
// What a question lists: the foundation keeps at most 20 candidates.
const MAX_CANDIDATES = 20;
// A name the user said, as quoted back to the model.
const MAX_QUOTED_LENGTH = 100;

const TEAMS_QUERY = `query LinearTeams { teams(first: ${PAGE_SIZE}) { nodes { id key name } pageInfo { hasNextPage } } }`;
const PROJECTS_QUERY = `query LinearTeamProjects($teamId: String!) { team(id: $teamId) { projects(first: ${PAGE_SIZE}) { nodes { id name } pageInfo { hasNextPage } } } }`;

const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const teamLabel = (team) => `${team.key} · ${team.name}`;
const quoted = (input) => input.trim().slice(0, MAX_QUOTED_LENGTH);

// The login a cache entry belongs to. A reconnect is a new generation, so
// nothing cached for the old login is ever read for the new one.
const loginKey = (binding) => `${binding?.ownerAccountId ?? ""}:${binding?.generation ?? ""}`;

function failure(result) {
  return { ok: false, outcome: result.outcome ?? "unknown", errorCode: result.errorCode };
}

function clarification(message, candidates) {
  return { ok: false, clarification: { message, candidates: candidates.slice(0, MAX_CANDIDATES) } };
}

function createLinearTeams({ api, now = Date.now, ttlMs = CACHE_TTL_MS }) {
  const cache = new Map();

  async function cached(key, load) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = await load();
    // Only answers are kept: a failure is asked again next time.
    if (value.ok) cache.set(key, { at: now(), value });
    return value;
  }

  function list(binding, token) {
    return cached(`${loginKey(binding)}|teams`, async () => {
      const result = await api.graphql(TEAMS_QUERY, {}, { token });
      if (!result.ok) return failure(result);
      const nodes = result.data?.teams?.nodes;
      if (!Array.isArray(nodes))
        return { ok: false, outcome: "unknown", errorCode: "bad_response" };
      const teams = nodes
        .filter(
          (team) =>
            nonEmptyString(team?.id) && nonEmptyString(team.key) && nonEmptyString(team.name)
        )
        .map((team) => ({ id: team.id, key: team.key, name: team.name }));
      return { ok: true, teams, truncated: result.data.teams.pageInfo?.hasNextPage === true };
    });
  }

  function projects(binding, token, teamId) {
    return cached(`${loginKey(binding)}|projects|${teamId}`, async () => {
      const result = await api.graphql(PROJECTS_QUERY, { teamId }, { token });
      if (!result.ok) return failure(result);
      // A team Linear doesn't return has no projects this login can use.
      if (result.data?.team === null) return { ok: true, projects: [], truncated: false };
      const connection = result.data?.team?.projects;
      if (!Array.isArray(connection?.nodes)) {
        return { ok: false, outcome: "unknown", errorCode: "bad_response" };
      }
      return {
        ok: true,
        projects: connection.nodes
          .filter((project) => nonEmptyString(project?.id) && nonEmptyString(project.name))
          .map((project) => ({ id: project.id, name: project.name })),
        truncated: connection.pageInfo?.hasNextPage === true,
      };
    });
  }

  async function resolveTeam(binding, token, input) {
    const listed = await list(binding, token);
    if (!listed.ok) return listed;
    const { teams, truncated } = listed;
    const everyTeam = teams.map(teamLabel);
    if (!nonEmptyString(input)) {
      // A single team is used without asking; with several, the user picks.
      if (teams.length === 1 && !truncated) return { ok: true, team: teams[0] };
      if (teams.length === 0) {
        return clarification("This Linear login can't see any team to create an issue in.", []);
      }
      return clarification("Which Linear team should this go to? Ask the user.", everyTeam);
    }
    const resolved = resolveTarget(
      input,
      teams.map((team) => ({ id: team.id, names: [team.key, team.name], team })),
      { exactOnly: truncated }
    );
    if (resolved.status === "match") return { ok: true, team: resolved.candidate.team };
    if (resolved.status === "ambiguous") {
      return clarification(
        `More than one Linear team matches "${quoted(input)}". Ask the user which one.`,
        resolved.candidates.map((candidate) => teamLabel(candidate.team))
      );
    }
    return clarification(
      `No Linear team matches "${quoted(input)}". Ask the user which team to use.`,
      everyTeam
    );
  }

  // An unknown project is dropped (and the card says so); an ambiguous one
  // is a question.
  async function resolveProject(binding, token, teamId, input) {
    if (!nonEmptyString(input)) return { ok: true, project: null, dropped: null };
    const listed = await projects(binding, token, teamId);
    if (!listed.ok) return listed;
    const resolved = resolveTarget(
      input,
      listed.projects.map((project) => ({ id: project.id, names: [project.name], project })),
      { exactOnly: listed.truncated }
    );
    if (resolved.status === "match") return { ok: true, project: resolved.candidate.project };
    if (resolved.status === "ambiguous") {
      return clarification(
        `More than one Linear project matches "${quoted(input)}". Ask the user which one.`,
        resolved.candidates.map((candidate) => candidate.project.name)
      );
    }
    return { ok: true, project: null, dropped: input.trim() };
  }

  // Forgets one login's teams and projects, or everything with no binding.
  function clear(binding) {
    if (!binding) {
      cache.clear();
      return;
    }
    const prefix = `${loginKey(binding)}|`;
    for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
  }

  return { list, resolveTeam, resolveProject, clear };
}

module.exports = { createLinearTeams, CACHE_TTL_MS };
