// The repositories the OpenWhispr GitHub App is installed on that the user
// can reach (spec §5.1). Search, create and comment work in these only.
const { resolveTarget } = require("./targetResolution");

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

function canTakeIssue(repo) {
  return !repo.archived && repo.hasIssues;
}

// The connector words the refusals: it knows the App's install link. A list
// cut at the read limit may be missing a repo that is installed after all.
function notInstalled(truncated) {
  return { ok: false, errorCode: truncated ? "repo_unlisted" : "not_installed" };
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
    // A suspended installation's repositories answer 403, so one suspended
    // org would fail every read; its repositories are out of reach anyway.
    const active = installations.items.filter(
      (installation) => Number.isInteger(installation?.id) && installation.suspended_at == null
    );
    const lists = await Promise.all(
      active.map((installation) =>
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

  // The list, read once more when `found(repos, truncated)` rejects one
  // older than REFETCH_AFTER_MS.
  async function listFinding(binding, token, found) {
    const listed = await list(binding, token);
    if (!listed.ok || found(listed.repos, listed.truncated === true)) return listed;
    return list(binding, token, { maxAgeMs: REFETCH_AFTER_MS });
  }

  // `owner/name` exactly (case-insensitive), or a bare name: the repos named
  // exactly that, else the ones it nearly names ("open whispr" for
  // open-whispr). One repo is used; several are a question for the user,
  // never a guess. `forNewIssue` asks only among repos that can take an
  // issue, and uses the one that can.
  async function resolveRepo(binding, token, input, { forNewIssue = false } = {}) {
    const wanted = typeof input === "string" ? input.trim() : "";
    const lower = wanted.toLowerCase();
    const byFullName = wanted.includes("/");
    const exact = byFullName
      ? (repo) => repo.fullName.toLowerCase() === lower
      : (repo) => repo.name.toLowerCase() === lower;
    const named = (repos, truncated) => {
      const matched = repos.filter(exact);
      // A cut list keeps to exact names: a looser match could be one of the
      // repos it never read.
      if (matched.length > 0 || byFullName || truncated) return matched;
      const near = resolveTarget(
        wanted,
        repos.map((repo) => ({ id: repo.fullName, names: [repo.name, repo.fullName], repo }))
      );
      if (near.status === "match") return [near.candidate.repo];
      return near.status === "ambiguous" ? near.candidates.map((candidate) => candidate.repo) : [];
    };
    const listed = await listFinding(binding, token, (repos, truncated) =>
      wanted ? named(repos, truncated).length > 0 : repos.length > 0
    );
    if (!listed.ok) return listed;
    const { repos } = listed;
    if (repos.length === 0) return { ok: false, errorCode: "no_repositories" };
    const found = wanted ? named(repos, listed.truncated === true) : repos;
    if (found.length === 0) return notInstalled(listed.truncated === true);
    // A single repo is used even if it can't take an issue: prepare says why.
    if (found.length === 1) return { ok: true, repo: found[0] };
    const choices = forNewIssue ? found.filter(canTakeIssue) : found;
    if (choices.length === 1) return { ok: true, repo: choices[0] };
    if (choices.length === 0) {
      return {
        ok: false,
        errorCode: "issues_disabled",
        message: wanted
          ? `None of the installed repositories named ${wanted} can take a new issue: each is archived or has issues turned off.`
          : "None of the installed repositories can take a new issue: each is archived or has issues turned off.",
      };
    }
    let message = "Ask the user which repository to use.";
    if (wanted) {
      message = exact(found[0])
        ? `Several installed repositories are named ${wanted}. Ask the user which one.`
        : `Several installed repositories match ${wanted}. Ask the user which one.`;
    }
    return {
      ok: false,
      clarification: {
        message,
        candidates: choices.slice(0, MAX_CANDIDATES).map((repo) => repo.fullName),
      },
    };
  }

  function clear(binding) {
    cache.delete(keyOf(binding));
  }

  return { list, listFinding, resolveRepo, clear };
}

module.exports = { createGithubInstallations, REFETCH_AFTER_MS };
