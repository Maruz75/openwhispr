// GitHub connector (spec §5): search issues and pull requests (a query),
// create an issue and comment (approval cards), only in the repositories the
// OpenWhispr GitHub App is installed on. The model only prepares; the card's
// Send commits exactly what the card shows, re-checked here first.
const { createGithubApi } = require("./githubApi");
const { createGithubAuth } = require("./githubAuth");
const { createGithubInstallations } = require("./githubInstallations");

const MAX_TITLE_LENGTH = 256;
const MAX_BODY_LENGTH = 65536;
const MAX_LABELS = 10;
const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 10;
const SNIPPET_LENGTH = 300;
// GitHub's 256-character search limit counts only the words, never the
// qualifiers, and MAX_QUERY_LENGTH already keeps the words under it. What
// bounds the `repo:` list is the request itself: GitHub answered 250
// qualifiers (a 5 KB URL) and failed with a 5xx near 8 KB.
const MAX_SEARCH_QUERY_LENGTH = 4000;
// Settings waits this long for the installed repository count, then shows
// the login without it.
const STATUS_REPOSITORIES_TIMEOUT_MS = 5000;

const STATES = new Set(["open", "all"]);
const TYPES = new Set(["issue", "pr", "any"]);
// A GitHub App user token can't search issues and pull requests together:
// GitHub refuses a `q` without one of these with a 422, so `any` is two
// searches.
const TYPE_QUALIFIERS = { issue: "is:issue", pr: "is:pull-request" };
// The scope is always the installed repos, so the user's own scope
// qualifiers (negated, quoted or after NOT too) are removed; every other
// qualifier (label:, author:, is:, …) passes through. A NOT left behind
// would negate whatever came next.
const SCOPE_QUALIFIER = /(^|\s)(?:NOT\s+)?-?(?:repo|org|user):(?:"[^"]*"?|\S*)/gi;
const LINE_BREAK = /[\r\n]/;
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const NUMBER_PATTERN = /^[1-9]\d{0,9}$/;
const SHORT_REFERENCE = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/;
const SEARCH_REPO_URL = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)$/;
const TRANSPORT_CODE = /^(E[A-Z0-9_]+|ERR_[A-Z0-9_]+|UND_ERR_[A-Z0-9_]+|timeout|network_error)$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/i;
// spec §6.1: no email address reaches the model, internationalized ones
// (josé@example.com, bob@exämple.com, a full-width ＠) included. A GitHub
// mention ("@alice", no local part before the @) is left alone.
const EMAIL_PATTERN = /[\p{L}\p{N}._%+-]+[@＠][\p{L}\p{N}.-]+\.\p{L}{2,}/gu;

const NO_REPOSITORIES_MESSAGE =
  "The OpenWhispr GitHub App isn't installed on any repository yet. Tell the user to choose repositories for it in Settings → Integrations → Connectors.";
const INVALID_REFERENCE = { ok: false, errorCode: "invalid_reference" };

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function characterCount(text) {
  return [...text].length;
}

function collapseWhitespace(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function redactEmails(text) {
  return String(text ?? "").replace(EMAIL_PATTERN, "[email]");
}

// At most `max` UTF-16 units, cut between code points (never inside a
// surrogate pair), ending in "…" when anything was cut.
function clip(text, max) {
  if (text.length <= max) return text;
  let kept = "";
  for (const character of text) {
    if (kept.length + character.length > max - 1) break;
    kept += character;
  }
  return `${kept}…`;
}

function reference(owner, repo, number) {
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo) || repo === "." || repo === "..") {
    return INVALID_REFERENCE;
  }
  if (!NUMBER_PATTERN.test(number)) return INVALID_REFERENCE;
  return { ok: true, owner, repo, number: Number(number) };
}

/**
 * An issue or pull request the user named: `owner/repo#12`, or its
 * github.com link (`/issues/12` or `/pull/12`, with anything after it).
 */
function parseGithubTarget(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  const short = SHORT_REFERENCE.exec(raw);
  if (short) return reference(short[1], short[2], short[3]);
  let url;
  try {
    url = new URL(raw);
  } catch {
    return INVALID_REFERENCE;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.port ||
    url.username ||
    url.password
  ) {
    return INVALID_REFERENCE;
  }
  const [, owner, repo, kind, number] = url.pathname.split("/");
  if (kind !== "issues" && kind !== "pull") return INVALID_REFERENCE;
  return reference(owner ?? "", repo ?? "", number ?? "");
}

/**
 * The `q` for GET /search/issues: the user's words without their own scope
 * qualifiers, the type (`issue` or `pr`) and state, then one `repo:` per
 * installed repo in the order given (most recently updated first) while `q`
 * stays within MAX_SEARCH_QUERY_LENGTH. `truncated` says some repos were
 * left out.
 */
function buildSearchQuery({ query, type, state = "open", repos = [] }) {
  const words = collapseWhitespace(String(query ?? "").replace(SCOPE_QUALIFIER, " "));
  const stateQualifier = state === "all" ? "" : "state:open";
  let q = [words, TYPE_QUALIFIERS[type], stateQualifier].filter(Boolean).join(" ");
  const searched = [];
  for (const fullName of repos) {
    const next = [q, `repo:${fullName}`].filter(Boolean).join(" ");
    if (next.length > MAX_SEARCH_QUERY_LENGTH) break;
    q = next;
    searched.push(fullName);
  }
  // Without a single repo: qualifier the search would cover every repo the
  // user can see, not only the installed ones.
  if (searched.length === 0) return { ok: false, errorCode: "too_long" };
  return { ok: true, q, repos: searched, truncated: searched.length < repos.length };
}

// English for the model; the card and the tool step show translated copy by
// errorCode.
function failureMessage(errorCode) {
  switch (errorCode) {
    case "reconnect_needed":
      return "GitHub needs to be reconnected under Settings → Integrations → Connectors.";
    case "connection_changed":
      return "The GitHub connection changed, so nothing was done.";
    case "rate_limited":
      return "GitHub is limiting requests right now. Try again later.";
    case "no_repositories":
      return NO_REPOSITORIES_MESSAGE;
    case "forbidden":
      return "GitHub refused: the user may not have permission for that in this repository.";
    case "not_found":
      return "GitHub couldn't find that issue or pull request.";
    case "issues_disabled":
      return "Issues are turned off in that repository.";
    case "archived":
      return "That repository is archived, so it can't take new issues or comments.";
    case "invalid":
      return "GitHub couldn't accept this as written.";
    case "too_long":
      return `Keep the title to ${MAX_TITLE_LENGTH} characters and the text to ${MAX_BODY_LENGTH} characters or fewer.`;
    case "invalid_reference":
      return "Give the issue or pull request as owner/repo#123 or its github.com link.";
    case "credential_save_failed":
      return "Couldn't save the refreshed GitHub login.";
    case "not_configured":
      return "GitHub isn't available in this build of OpenWhispr.";
    case "network":
      return "Couldn't reach GitHub.";
    default:
      return TRANSPORT_CODE.test(errorCode ?? "")
        ? "Couldn't reach GitHub."
        : "GitHub refused the request.";
  }
}

function failed(errorCode, message = failureMessage(errorCode)) {
  return { status: "failed", errorCode, message };
}

function commitFailed(errorCode, message = failureMessage(errorCode)) {
  return { state: "failed", errorCode, message };
}

// A lookup's failure: its own message when it has one, and the install link
// for a repo the App isn't on.
function failedWith(failure) {
  return {
    ...failed(failure.errorCode, failure.message ?? failureMessage(failure.errorCode)),
    ...(failure.installUrl ? { installUrl: failure.installUrl } : {}),
  };
}

function commitFailedWith(failure) {
  return {
    ...commitFailed(failure.errorCode, failure.message ?? failureMessage(failure.errorCode)),
    ...(failure.installUrl ? { installUrl: failure.installUrl } : {}),
  };
}

function clarify(message, candidates = []) {
  return { status: "needs_clarification", message, candidates };
}

// Up to MAX_LABELS distinct names, in the order given.
function labelList(value) {
  const seen = new Set();
  const labels = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (typeof raw !== "string") continue;
    const label = raw.trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels.slice(0, MAX_LABELS);
}

function repoPath(repo) {
  return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

function findInstalled(repos, owner, name) {
  const wanted = `${owner}/${name}`.toLowerCase();
  return repos.find((repo) => repo.fullName.toLowerCase() === wanted) ?? null;
}

function searchItem(raw, fullName) {
  if (!Number.isInteger(raw?.number) || !nonEmptyString(raw?.html_url)) return null;
  const pullRequest = raw.pull_request && typeof raw.pull_request === "object";
  const state = pullRequest && raw.pull_request.merged_at ? "merged" : raw.state;
  return {
    reference: `${fullName}#${raw.number}`,
    isPullRequest: Boolean(pullRequest),
    title: clip(collapseWhitespace(redactEmails(raw.title)), MAX_TITLE_LENGTH),
    state: state === "closed" || state === "merged" ? state : "open",
    url: raw.html_url,
    updatedAt: nonEmptyString(raw.updated_at) ? raw.updated_at : null,
    assignee: nonEmptyString(raw.assignee?.login) ? raw.assignee.login : null,
    author: nonEmptyString(raw.user?.login) ? raw.user.login : null,
    labels: (Array.isArray(raw.labels) ? raw.labels : [])
      .map((label) => (typeof label === "string" ? label : label?.name))
      .filter(nonEmptyString),
    snippet: clip(collapseWhitespace(redactEmails(raw.body)), SNIPPET_LENGTH),
  };
}

function createGithubConnector({
  api,
  auth,
  installations,
  credentials,
  getSlug = () => null,
  statusTimeoutMs = STATUS_REPOSITORIES_TIMEOUT_MS,
}) {
  function manageUrl() {
    const slug = getSlug();
    return typeof slug === "string" && SLUG_PATTERN.test(slug)
      ? `https://github.com/apps/${slug}/installations/new`
      : null;
  }

  // `truncated`: the installations listed more repositories than OpenWhispr
  // reads, so the repo may be installed after all.
  function notInstalled(fullName, truncated = false) {
    const installUrl = manageUrl();
    const message = truncated
      ? `The OpenWhispr GitHub App isn't installed on ${fullName}, as far as OpenWhispr can tell: it reads the first 1,000 repositories of each installation. Ask the user to check the name.`
      : `The OpenWhispr GitHub App isn't installed on ${fullName}.`;
    return {
      errorCode: "not_installed",
      message: installUrl
        ? `${message} Tell the user to install it on that repository: ${installUrl}`
        : `${message} Tell the user to install it on that repository from Settings → Integrations → Connectors.`,
      ...(installUrl ? { installUrl } : {}),
    };
  }

  // One action's requests share this: the bound login and its current token.
  // A 401 means GitHub refused and did nothing, so it is refreshed once under
  // the same login and asked again; a second 401 means the login is gone.
  async function call(session, send) {
    const first = await send(session.token);
    if (first.ok || first.errorCode !== "unauthorized") return first;
    const refreshed = await auth.refreshRejected(session.binding, session.token);
    if (!refreshed.ok) return { ok: false, outcome: "failed", errorCode: refreshed.errorCode };
    session.token = refreshed.token;
    const second = await send(session.token);
    if (!second.ok && second.errorCode === "unauthorized") {
      return {
        ok: false,
        outcome: "failed",
        errorCode: auth.markReconnect(session.binding).errorCode,
      };
    }
    return second;
  }

  async function openSession(binding) {
    const access = await auth.getAccessToken(binding);
    if (!access.ok) return { failure: { errorCode: access.errorCode } };
    return { session: { binding, token: access.token, login: access.credential.login } };
  }

  async function installedRepos(session) {
    const listed = await call(session, (token) => installations.list(session.binding, token));
    if (!listed.ok) return { failure: { errorCode: listed.errorCode } };
    if (listed.repos.length === 0) return { failure: { errorCode: "no_repositories" } };
    return { repos: listed.repos, truncated: listed.truncated === true };
  }

  // An installed repo that can take new issues and comments, or why not.
  function writableRepo(repo, fullName, truncated) {
    if (!repo) return { failure: notInstalled(fullName, truncated) };
    if (repo.archived) {
      return {
        failure: {
          errorCode: "archived",
          message: `${repo.fullName} is archived, so it can't take new issues or comments.`,
        },
      };
    }
    return { repo };
  }

  async function resolveRepo(session, input) {
    const resolved = await call(session, (token) =>
      installations.resolveRepo(session.binding, token, input)
    );
    if (resolved.ok) return { repo: resolved.repo };
    if (resolved.clarification) return { clarification: resolved.clarification };
    if (resolved.errorCode === "not_installed") {
      return { failure: notInstalled(input.trim(), resolved.truncated === true) };
    }
    return { failure: { errorCode: resolved.errorCode } };
  }

  // GitHub answers 403 or 404 for a repo the App isn't installed on (any
  // more): the installations are read again to tell that apart.
  async function refusal(session, result, repo) {
    if (result.errorCode === "forbidden" || result.errorCode === "not_found") {
      installations.clear(session.binding);
      const listed = await call(session, (token) => installations.list(session.binding, token));
      if (listed.ok && !findInstalled(listed.repos, repo.owner, repo.name)) {
        return notInstalled(repo.fullName, listed.truncated === true);
      }
    }
    return { errorCode: result.errorCode };
  }

  // The issue or PR a comment goes on, in an installed repo, still open to
  // comments. Read at prepare and again at Send.
  async function readTarget(session, target) {
    const installed = await installedRepos(session);
    if (installed.failure) return installed;
    const writable = writableRepo(
      findInstalled(installed.repos, target.owner, target.repo),
      `${target.owner}/${target.repo}`,
      installed.truncated
    );
    if (writable.failure) return writable;
    const { repo } = writable;
    const read = await call(session, (token) =>
      api.rest("GET", `${repoPath(repo)}/issues/${target.number}`, { token })
    );
    if (!read.ok) {
      // GitHub answers 410 both when a repo's issues are off and when the
      // issue was deleted; the installed repo says which.
      if (read.errorCode === "issues_disabled" && repo.hasIssues) {
        return {
          failure: {
            errorCode: "not_found",
            message: `${repo.fullName}#${target.number} was deleted.`,
          },
        };
      }
      return { failure: await refusal(session, read, repo) };
    }
    const issue = read.data;
    if (!Number.isInteger(issue?.number) || !nonEmptyString(issue?.html_url)) {
      return {
        failure: { errorCode: "bad_response", message: "GitHub's answer couldn't be read." },
      };
    }
    // fetch follows redirects, and GitHub 301s a transferred issue: the
    // reply can be a different issue than the one asked for (another
    // number, another repo, another title). Never trust it for the
    // destination or the payload without checking it answered the number
    // asked for, in this repo.
    const expectedIssueUrl =
      `https://github.com/${repo.fullName}/issues/${target.number}`.toLowerCase();
    const expectedPullUrl =
      `https://github.com/${repo.fullName}/pull/${target.number}`.toLowerCase();
    const actualUrl = issue.html_url.toLowerCase();
    if (
      issue.number !== target.number ||
      (actualUrl !== expectedIssueUrl && actualUrl !== expectedPullUrl)
    ) {
      return {
        failure: {
          errorCode: "not_found",
          message: `GitHub couldn't find that issue or pull request in ${repo.fullName}; it may have moved.`,
        },
      };
    }
    const destination = `${repo.fullName}#${target.number}`;
    // GitHub still takes comments on a locked conversation from people who
    // can push to the repo.
    if (issue.locked === true && !repo.canPush) {
      return {
        failure: {
          errorCode: "locked",
          message: `The conversation on ${destination} is locked, so it can't take new comments.`,
        },
      };
    }
    return {
      repo,
      destination,
      issue: {
        number: target.number,
        title: typeof issue.title === "string" ? issue.title : "",
        isPullRequest: Boolean(issue.pull_request),
        url: issue.html_url,
      },
    };
  }

  async function searchIssues(args, binding) {
    const query = typeof args?.query === "string" ? args.query.trim() : "";
    if (!query) return clarify("Ask the user what to search GitHub for.");
    if (characterCount(query) > MAX_QUERY_LENGTH) {
      return failed("too_long", `Keep the search to ${MAX_QUERY_LENGTH} characters or fewer.`);
    }
    const state = args?.state ?? "open";
    const type = args?.type ?? "any";
    if (!STATES.has(state) || !TYPES.has(type)) {
      return failed("invalid", "state is open or all, and type is issue, pr or any.");
    }
    const opened = await openSession(binding);
    if (opened.failure) return failedWith(opened.failure);
    const { session } = opened;

    let scope;
    // The installations listed more repos than OpenWhispr reads: some went
    // unsearched.
    let unlisted = false;
    if (typeof args?.repo === "string" && args.repo.trim()) {
      const resolved = await resolveRepo(session, args.repo);
      if (resolved.clarification) {
        return clarify(resolved.clarification.message, resolved.clarification.candidates);
      }
      if (resolved.failure) return failedWith(resolved.failure);
      scope = [resolved.repo];
    } else {
      const installed = await installedRepos(session);
      if (installed.failure) return failedWith(installed.failure);
      scope = installed.repos;
      unlisted = installed.truncated;
    }

    const repoNames = scope.map((r) => r.fullName);
    const searches = (type === "any" ? ["issue", "pr"] : [type]).map((kind) =>
      buildSearchQuery({ query, type: kind, state, repos: repoNames })
    );
    if (searches.some((built) => !built.ok)) {
      return failed(
        "too_long",
        "The search is too long to limit to the user's repositories. Ask for a shorter search."
      );
    }
    const pages = await Promise.all(
      searches.map((built) =>
        call(session, (token) =>
          api.rest("GET", "/search/issues", {
            token,
            query: { q: built.q, sort: "updated", order: "desc", per_page: MAX_RESULTS },
          })
        )
      )
    );
    const failure = pages.find((found) => !found.ok);
    // A transport failure (offline, DNS, reset, timeout) would otherwise
    // reach normalizeQueryResult as an unrecognized code and get rewritten to
    // generic "query_failed" copy; "network" is a code it accepts as is.
    if (failure) {
      return failed(TRANSPORT_CODE.test(failure.errorCode ?? "") ? "network" : failure.errorCode);
    }
    const items = [];
    let truncated = unlisted;
    searches.forEach((built, index) => {
      const found = pages[index];
      const searched = new Map(built.repos.map((fullName) => [fullName.toLowerCase(), fullName]));
      const raws = Array.isArray(found.data?.items) ? found.data.items : [];
      for (const raw of raws) {
        const match = SEARCH_REPO_URL.exec(raw?.repository_url ?? "");
        // GitHub may answer with repos the user can see but didn't install
        // the App on; those never reach the model.
        const fullName = match ? searched.get(`${match[1]}/${match[2]}`.toLowerCase()) : null;
        const item = fullName ? searchItem(raw, fullName) : null;
        if (item) items.push(item);
      }
      const total = found.data?.total_count;
      truncated ||=
        built.truncated ||
        found.data?.incomplete_results === true ||
        (Number.isInteger(total) && total > raws.length);
    });
    // Most recently updated first across both searches, as each one is.
    items.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return {
      status: "ok",
      items: items.slice(0, MAX_RESULTS),
      truncated: truncated || items.length > MAX_RESULTS,
    };
  }

  async function prepareIssue(args, binding) {
    // A title is one line: line breaks become spaces.
    const title = typeof args?.title === "string" ? args.title.replace(/[\r\n]+/g, " ").trim() : "";
    if (!title) return clarify("Ask the user what the issue's title should be.");
    if (characterCount(title) > MAX_TITLE_LENGTH) {
      return failed("too_long", `Keep the title to ${MAX_TITLE_LENGTH} characters or fewer.`);
    }
    const body = typeof args?.body === "string" ? args.body : "";
    if (characterCount(body) > MAX_BODY_LENGTH) {
      return failed("too_long", `Keep the description to ${MAX_BODY_LENGTH} characters or fewer.`);
    }
    const requested = labelList(args?.labels);

    const opened = await openSession(binding);
    if (opened.failure) return failedWith(opened.failure);
    const { session } = opened;
    const resolved = await resolveRepo(session, typeof args?.repo === "string" ? args.repo : "");
    if (resolved.clarification) {
      return clarify(
        `${resolved.clarification.message} The issue can go in any of these.`,
        resolved.clarification.candidates
      );
    }
    if (resolved.failure) return failedWith(resolved.failure);
    const writable = writableRepo(resolved.repo);
    if (writable.failure) return failedWith(writable.failure);
    const { repo } = writable;

    const labels = [];
    const dropped = [];
    if (requested.length > 0) {
      const listed = await call(session, (token) =>
        api.restAll(`${repoPath(repo)}/labels`, { token, query: { per_page: 100 } })
      );
      if (!listed.ok) {
        const refused = await refusal(session, listed, repo);
        return failedWith(refused);
      }
      const existing = new Map(
        listed.items
          .filter((label) => nonEmptyString(label?.name))
          .map((label) => [label.name.toLowerCase(), label.name])
      );
      for (const label of requested) {
        const match = existing.get(label.toLowerCase());
        if (match) labels.push(match);
        else dropped.push(label);
      }
    }

    const notes = [];
    if (labels.length > 0) {
      notes.push({
        key: "connectors.approval.issue.notes.labels",
        values: { labels: labels.join(", ") },
      });
    }
    if (dropped.length > 0) {
      notes.push({
        key: "connectors.approval.issue.notes.droppedLabels",
        values: { destination: repo.fullName, labels: dropped.join(", ") },
      });
    }
    // GitHub silently drops labels when the user can't push to the repo.
    if (labels.length > 0 && !repo.canPush) {
      notes.push({ key: "connectors.approval.github.notes.labelsMayNotApply" });
    }

    return {
      status: "ready",
      payload: { owner: repo.owner, repo: repo.name, title, body, labels },
      preview: {
        verbKey: "issue",
        destinationLabel: repo.fullName,
        accountLabel: `@${session.login}`,
        body,
        fields: { title, body },
        notes,
      },
    };
  }

  async function prepareComment(args, binding) {
    const target = parseGithubTarget(args?.target);
    if (!target.ok) return failed("invalid_reference");
    const body = typeof args?.body === "string" ? args.body : "";
    if (!body.trim()) return clarify("Ask the user what the comment should say.");
    if (characterCount(body) > MAX_BODY_LENGTH) {
      return failed("too_long", `Keep the comment to ${MAX_BODY_LENGTH} characters or fewer.`);
    }
    const opened = await openSession(binding);
    if (opened.failure) return failedWith(opened.failure);
    const { session } = opened;
    const read = await readTarget(session, target);
    if (read.failure) return failedWith(read.failure);

    const notes = [
      {
        key: "connectors.approval.comment.notes.targetTitle",
        values: { title: clip(collapseWhitespace(read.issue.title), MAX_TITLE_LENGTH) },
      },
    ];
    if (read.issue.isPullRequest)
      notes.push({ key: "connectors.approval.github.notes.pullRequest" });
    return {
      status: "ready",
      payload: { owner: read.repo.owner, repo: read.repo.name, number: read.issue.number, body },
      preview: {
        verbKey: "comment",
        destinationLabel: read.destination,
        accountLabel: `@${session.login}`,
        body,
        fields: { body },
        notes,
      },
    };
  }

  // The card's title and description, over what prepare stored.
  function issueEdits(payload, edits) {
    const changes = edits ?? {};
    const rawTitle = typeof changes.title === "string" ? changes.title : payload.title;
    const body = typeof changes.body === "string" ? changes.body : payload.body;
    // Every check from prepare again, before anything reaches GitHub.
    if (LINE_BREAK.test(rawTitle)) {
      return commitFailed("invalid", "The title must be a single line, so nothing was created.");
    }
    const title = rawTitle.trim();
    if (!title) return commitFailed("invalid", "The issue has no title, so nothing was created.");
    if (characterCount(title) > MAX_TITLE_LENGTH || characterCount(body) > MAX_BODY_LENGTH) {
      return commitFailed("too_long");
    }
    return { title, body };
  }

  async function createIssue(payload, edits, binding) {
    const checked = issueEdits(payload, edits);
    if (checked.state === "failed") return checked;
    const opened = await openSession(binding);
    if (opened.failure) return commitFailedWith(opened.failure);
    const { session } = opened;
    const installed = await installedRepos(session);
    if (installed.failure) return commitFailedWith(installed.failure);
    const writable = writableRepo(
      findInstalled(installed.repos, payload.owner, payload.repo),
      `${payload.owner}/${payload.repo}`,
      installed.truncated
    );
    if (writable.failure) return commitFailedWith(writable.failure);
    const { repo } = writable;
    const created = await call(session, (token) =>
      api.rest("POST", `${repoPath(repo)}/issues`, {
        token,
        body: {
          title: checked.title,
          body: checked.body,
          ...(payload.labels.length > 0 ? { labels: payload.labels } : {}),
        },
      })
    );
    const checkUrl = `https://github.com/${repo.fullName}/issues`;
    if (created.ok) {
      const { number, html_url: url } = created.data ?? {};
      if (Number.isInteger(number) && nonEmptyString(url)) {
        return { state: "sent", url, resultLabel: `${repo.fullName}#${number}` };
      }
      return { state: "unknown", errorCode: "bad_response", checkUrl };
    }
    if (created.outcome === "failed") {
      const refused = await refusal(session, created, repo);
      return commitFailedWith(refused);
    }
    // GitHub has no idempotency key, so an uncertain create is never repeated.
    return { state: "unknown", errorCode: created.errorCode, checkUrl };
  }

  async function postComment(payload, edits, binding) {
    const body = typeof edits?.body === "string" ? edits.body : payload.body;
    if (!body.trim())
      return commitFailed("invalid", "The comment is empty, so nothing was posted.");
    if (characterCount(body) > MAX_BODY_LENGTH) return commitFailed("too_long");
    const opened = await openSession(binding);
    if (opened.failure) return commitFailedWith(opened.failure);
    const { session } = opened;
    const read = await readTarget(session, {
      owner: payload.owner,
      repo: payload.repo,
      number: payload.number,
    });
    if (read.failure) return commitFailedWith(read.failure);
    const posted = await call(session, (token) =>
      api.rest("POST", `${repoPath(read.repo)}/issues/${read.issue.number}/comments`, {
        token,
        body: { body },
      })
    );
    if (posted.ok) {
      return nonEmptyString(posted.data?.html_url)
        ? { state: "sent", url: posted.data.html_url }
        : { state: "unknown", errorCode: "bad_response", checkUrl: read.issue.url };
    }
    if (posted.outcome === "failed") {
      const refused = await refusal(session, posted, read.repo);
      return commitFailedWith(refused);
    }
    return { state: "unknown", errorCode: posted.errorCode, checkUrl: read.issue.url };
  }

  function bindingFor(ownerAccountId, entry) {
    return {
      ownerAccountId,
      accountId: String(entry.credential.userId),
      generation: entry.generation,
    };
  }

  async function countRepos(binding, signal) {
    const opened = await openSession(binding);
    if (opened.failure || signal.aborted) return null;
    const listed = await call(opened.session, (token) =>
      installations.list(binding, token, { signal })
    );
    return listed.ok ? String(listed.repos.length) : null;
  }

  // The installed repo count for the row, within statusTimeoutMs. Best
  // effort: a failure or a timeout leaves it unknown (null, never "0"), and
  // the rest of the status stands.
  async function repoCount(binding) {
    const signal = AbortSignal.timeout(statusTimeoutMs);
    const gaveUp = new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve(null), { once: true });
    });
    return Promise.race([countRepos(binding, signal).catch(() => null), gaveUp]);
  }

  return {
    id: "github",
    actions: {
      search_issues: { kind: "query" },
      create_issue: { kind: "approval", editable: { title: "line", body: "text" } },
      comment: { kind: "approval", editable: { body: "text" } },
    },

    async getStatus() {
      const url = manageUrl();
      const withManage = (status) => (url ? { ...status, manageUrl: url } : status);
      const ownerAccountId = credentials.activeAccountId();
      const entry = credentials.read(ownerAccountId, "github");
      if (!entry) {
        return withManage({
          connected: false,
          // Without the App's slug there's no way to choose repositories, and
          // every action would end in no_repositories.
          configured: auth.isConfigured() && url !== null,
          accountLabel: null,
          workspaceLabel: null,
          needsReconnect: false,
        });
      }
      // A login always reports configured, so Disconnect stays reachable.
      const status = { ...auth.statusOf(entry.credential), configured: true };
      if (status.needsReconnect) return withManage(status);
      const binding = bindingFor(ownerAccountId, entry);
      // The count shown here must reflect an install picked on GitHub's own
      // page moments ago, so it never serves the 60 s cache tools use; the
      // clear only affects this read, not the search/prepare calls after it.
      installations.clear(binding);
      return withManage({
        ...status,
        workspaceLabel: await repoCount(binding),
      });
    },

    async getBinding() {
      const ownerAccountId = credentials.activeAccountId();
      const entry = credentials.read(ownerAccountId, "github");
      return entry ? bindingFor(ownerAccountId, entry) : null;
    },

    async query(action, args, { binding } = {}) {
      if (action !== "search_issues") return failed("unknown_action", "Unknown GitHub action.");
      return searchIssues(args, binding);
    },

    async prepare(action, args, { binding } = {}) {
      if (action === "create_issue") return prepareIssue(args, binding);
      if (action === "comment") return prepareComment(args, binding);
      return failed("unknown_action", "Unknown GitHub action.");
    },

    async commit(action, payload, edits, { binding } = {}) {
      if (action === "create_issue") return createIssue(payload, edits, binding);
      if (action === "comment") return postComment(payload, edits, binding);
      return commitFailed("unknown_action", "Unknown GitHub action.");
    },

    authorize: (options) => auth.authorize(options),
    revoke: () => auth.revoke(),
  };
}

// Foundation §9.3: one api, auth and installations instance for every
// consumer, so concurrent actions share one single-flight refresh (GitHub's
// refresh tokens are single-use).
function buildGithubConnector(deps) {
  const api = createGithubApi({ fetchImpl: deps.fetch });
  const auth = createGithubAuth({
    api,
    credentials: deps.credentials,
    getClientId: () => deps.env?.GITHUB_APP_CLIENT_ID,
    broadcast: deps.broadcast,
    logger: deps.logger,
  });
  return createGithubConnector({
    api,
    auth,
    installations: createGithubInstallations({ api }),
    credentials: deps.credentials,
    getSlug: () => deps.env?.GITHUB_APP_SLUG,
  });
}

module.exports = {
  createGithubConnector,
  buildGithubConnector,
  parseGithubTarget,
  buildSearchQuery,
  STATUS_REPOSITORIES_TIMEOUT_MS,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  MAX_LABELS,
  MAX_RESULTS,
  SNIPPET_LENGTH,
};
