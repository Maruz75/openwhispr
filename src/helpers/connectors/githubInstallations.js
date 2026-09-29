// The repositories the OpenWhispr GitHub App is installed on that the user
// can reach (spec §5.1). Search, create and comment work in these only.
const MAX_CANDIDATES = 20;
const TIMED_OUT = { ok: false, outcome: "unknown", errorCode: "timeout" };

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function toRepo(raw) {
  const owner = raw?.owner?.login;
  if (![owner, raw?.name, raw?.full_name].every(nonEmptyString)) return null;
  return {
    owner,
    name: raw.name,
    fullName: raw.full_name,
    private: raw.private === true,
    // Tells a deleted issue's 410 apart from a repo with issues turned off.
    hasIssues: raw.has_issues !== false,
    updatedAt: nonEmptyString(raw.updated_at) ? raw.updated_at : null,
  };
}

// Most recently updated first: when a search can't name every repo, these
// are the ones it keeps.
function byRecentUpdate(a, b) {
  return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
}

function candidatesOf(repos) {
  return repos.slice(0, MAX_CANDIDATES).map((repo) => repo.fullName);
}

function notInstalled(name) {
  return {
    ok: false,
    errorCode: "not_installed",
    message: `The OpenWhispr GitHub App isn't installed on ${name}.`,
  };
}

function whenAborted(signal) {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(TIMED_OUT);
    else signal.addEventListener("abort", () => resolve(TIMED_OUT), { once: true });
  });
}

function createGithubInstallations({ api, now = Date.now, ttlMs = 60 * 1000 }) {
  // Keyed by the login (its slot generation changes on every reconnect), so a
  // list read for one login is never served to another.
  const cache = new Map();
  const keyOf = (binding) => `${binding?.ownerAccountId}:${binding?.generation}`;

  async function load(token) {
    const installations = await api.restAll("/user/installations", {
      token,
      query: { per_page: 100 },
      key: "installations",
    });
    if (!installations.ok) return installations;
    const repos = [];
    for (const installation of installations.items) {
      if (!Number.isInteger(installation?.id)) continue;
      const listed = await api.restAll(`/user/installations/${installation.id}/repositories`, {
        token,
        query: { per_page: 100 },
        key: "repositories",
      });
      if (!listed.ok) return listed;
      for (const raw of listed.items) {
        const repo = toRepo(raw);
        if (repo) repos.push(repo);
      }
    }
    return {
      ok: true,
      repos: repos.sort(byRecentUpdate),
      installationCount: installations.items.length,
    };
  }

  // `signal` lets a caller stop waiting (the Settings status gives up after
  // a few seconds). A read it gave up on is never cached, even if it lands.
  async function list(binding, token, { signal } = {}) {
    const key = keyOf(binding);
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.result;
    const result = signal
      ? await Promise.race([load(token), whenAborted(signal)])
      : await load(token);
    // Only a full answer is cached: a failure is asked again next time.
    if (result.ok && !signal?.aborted) cache.set(key, { at: now(), result });
    return result;
  }

  // `owner/name` exactly (case-insensitive), or a bare name when exactly one
  // installed repo has it. Anything else is a question for the user, never
  // a guess.
  async function resolveRepo(binding, token, input) {
    const listed = await list(binding, token);
    if (!listed.ok) return listed;
    const { repos } = listed;
    if (repos.length === 0) {
      return {
        ok: false,
        errorCode: "no_repositories",
        message:
          "The OpenWhispr GitHub App isn't installed on any repository yet. Tell the user to choose repositories for it in Settings → Integrations → Connectors.",
      };
    }
    const wanted = typeof input === "string" ? input.trim() : "";
    if (!wanted) {
      if (repos.length === 1) return { ok: true, repo: repos[0] };
      return {
        ok: false,
        clarification: {
          message: "Ask the user which repository to use.",
          candidates: candidatesOf(repos),
        },
      };
    }
    const lower = wanted.toLowerCase();
    if (wanted.includes("/")) {
      const match = repos.find((repo) => repo.fullName.toLowerCase() === lower);
      return match ? { ok: true, repo: match } : notInstalled(wanted);
    }
    const named = repos.filter((repo) => repo.name.toLowerCase() === lower);
    if (named.length === 1) return { ok: true, repo: named[0] };
    if (named.length > 1) {
      return {
        ok: false,
        clarification: {
          message: `Several installed repositories are named ${wanted}. Ask the user which one.`,
          candidates: candidatesOf(named),
        },
      };
    }
    return notInstalled(wanted);
  }

  function clear(binding) {
    cache.delete(keyOf(binding));
  }

  return { list, resolveRepo, clear };
}

module.exports = { createGithubInstallations };
