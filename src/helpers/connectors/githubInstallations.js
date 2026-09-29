// The repositories the OpenWhispr GitHub App is installed on that the user
// can reach (spec §5.1). Search, create and comment work in these only.
const MAX_CANDIDATES = 20;
// A repo that's missing from a list older than this is looked for once more
// in a fresh one: after a "not installed" answer, the user can install the
// App from its link and ask again within seconds.
const REFETCH_AFTER_MS = 5 * 1000;
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
    // An archived repo is read-only: nothing can be created or commented.
    archived: raw.archived === true,
    // The user's own access: with push they can still comment on a locked
    // conversation.
    canPush: raw.permissions?.push === true,
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

function notInstalled(name, truncated) {
  return {
    ok: false,
    errorCode: "not_installed",
    message: `The OpenWhispr GitHub App isn't installed on ${name}.`,
    truncated,
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

  // `truncated` says an installation had more repositories than restAll
  // reads (1,000), so a repo missing from the list may still be installed.
  async function load(token, signal) {
    const installations = await api.restAll("/user/installations", {
      token,
      query: { per_page: 100 },
      key: "installations",
      signal,
    });
    if (!installations.ok) return installations;
    const lists = await Promise.all(
      installations.items
        .filter((installation) => Number.isInteger(installation?.id))
        .map((installation) =>
          api.restAll(`/user/installations/${installation.id}/repositories`, {
            token,
            query: { per_page: 100 },
            key: "repositories",
            signal,
          })
        )
    );
    const failure = lists.find((listed) => !listed.ok);
    if (failure) return failure;
    const repos = lists.flatMap((listed) => listed.items.map(toRepo).filter(Boolean));
    return {
      ok: true,
      repos: repos.sort(byRecentUpdate),
      installationCount: installations.items.length,
      truncated: lists.some((listed) => listed.truncated) || installations.truncated === true,
    };
  }

  // `signal` lets a caller stop waiting (the Settings status gives up after
  // a few seconds). A read it gave up on is never cached, even if it lands.
  // `maxAgeMs` asks for a list younger than the cache keeps.
  async function list(binding, token, { signal, maxAgeMs = ttlMs } = {}) {
    const key = keyOf(binding);
    const hit = cache.get(key);
    if (hit && now() - hit.at < maxAgeMs) return hit.result;
    // The signal also stops the requests, so a read given up on doesn't keep
    // paging through GitHub in the background.
    const result = signal
      ? await Promise.race([load(token, signal), whenAborted(signal)])
      : await load(token);
    // Only a full answer is cached: a failure is asked again next time.
    if (result.ok && !signal?.aborted) cache.set(key, { at: now(), result });
    return result;
  }

  // The list, read once more when `found` rejects one older than
  // REFETCH_AFTER_MS.
  async function listFinding(binding, token, found) {
    const listed = await list(binding, token);
    if (!listed.ok || found(listed.repos)) return listed;
    return list(binding, token, { maxAgeMs: REFETCH_AFTER_MS });
  }

  // `owner/name` exactly (case-insensitive), or a bare name when exactly one
  // installed repo has it. Anything else is a question for the user, never
  // a guess.
  async function resolveRepo(binding, token, input) {
    const wanted = typeof input === "string" ? input.trim() : "";
    const lower = wanted.toLowerCase();
    const matches = wanted.includes("/")
      ? (repo) => repo.fullName.toLowerCase() === lower
      : (repo) => repo.name.toLowerCase() === lower;
    const listed = await listFinding(binding, token, (repos) =>
      wanted ? repos.some(matches) : repos.length > 0
    );
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
    if (wanted.includes("/")) {
      const match = repos.find(matches);
      return match ? { ok: true, repo: match } : notInstalled(wanted, listed.truncated);
    }
    const named = repos.filter(matches);
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
    return notInstalled(wanted, listed.truncated);
  }

  function clear(binding) {
    cache.delete(keyOf(binding));
  }

  return { list, listFinding, resolveRepo, clear };
}

module.exports = { createGithubInstallations, REFETCH_AFTER_MS };
