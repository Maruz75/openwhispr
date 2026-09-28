// Gmail send connector (spec §5.1), the second approval connector. The
// model only prepares; the card's Send commits exactly what the card shows,
// rebuilt and re-checked here.
const {
  isValidEmailAddress,
  bareEmailAddress,
  recipientsLabel,
  MAX_EMAIL_RECIPIENTS: MAX_RECIPIENTS,
  MAX_EMAIL_SUBJECT_LENGTH: MAX_SUBJECT_LENGTH,
} = require("./emailCompose");
const { buildRawMessage } = require("./gmailMime");

const LINE_BREAK = /[\r\n]/;
const TRANSPORT_CODE = /^(E[A-Z0-9_]+|ERR_[A-Z0-9_]+|UND_ERR_[A-Z0-9_]+|timeout|network_error)$/;

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

// Trimmed, bare (a "Name <address>" keeps only the address) and de-duplicated
// case-insensitively. An address in both To and Cc stays in To only.
function normalizeRecipients({ to, cc } = {}) {
  const seen = new Set();
  const invalid = [];
  const clean = (list) => {
    const kept = [];
    for (const raw of stringList(list)) {
      const address = bareEmailAddress(raw);
      const key = address.toLowerCase();
      if (!address || seen.has(key)) continue;
      seen.add(key);
      if (isValidEmailAddress(address)) kept.push(address);
      else invalid.push(address);
    }
    return kept;
  };
  const toList = clean(to);
  const ccList = clean(cc);
  return { to: toList, cc: ccList, invalid };
}

// Plan 3 Task 1 checked the #sent/<id> link (spec §10).
function sentMessageUrl(email, id) {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#sent/${id}`;
}

function sentFolderUrl(email) {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#sent`;
}

function characterCount(text) {
  return [...text].length;
}

// English for the model; the card shows translated copy by errorCode.
function failureMessage(errorCode) {
  switch (errorCode) {
    case "reconnect_needed":
      return "Gmail needs to be reconnected under Settings → Integrations → Connectors.";
    case "connection_changed":
      return "The Gmail connection changed before sending, so nothing was sent.";
    case "daily_limit":
      return "Gmail's daily sending limit was reached.";
    case "rate_limited":
      return "Gmail is busy. Try again shortly.";
    case "domain_policy":
      return "The user's Google Workspace admin blocked this app from sending email.";
    case "too_many_recipients":
      return `An email can go to at most ${MAX_RECIPIENTS} recipients, To and Cc together.`;
    case "too_long":
      return `The email is too long for Gmail: at most ${MAX_SUBJECT_LENGTH} characters of subject and 1 MB in all.`;
    case "invalid_recipients":
      return "An address isn't a valid email address.";
    case "invalid_message":
      return "Gmail couldn't accept this message as written.";
    case "header_injection":
      return "A subject or address contained a line break.";
    case "gmail_unavailable":
      return "Sending with Gmail isn't available in this build of OpenWhispr right now.";
    case "credential_save_failed":
      return "Couldn't save the refreshed Gmail login.";
    case "network":
      return "Couldn't reach Google.";
    default:
      return TRANSPORT_CODE.test(errorCode ?? "")
        ? "Couldn't reach Google."
        : "Gmail refused the message.";
  }
}

function clarify(message) {
  return { status: "needs_clarification", message, candidates: [] };
}

function prepareFailed(errorCode, message = failureMessage(errorCode)) {
  return { status: "failed", errorCode, message };
}

function commitFailed(errorCode, message = failureMessage(errorCode)) {
  return { state: "failed", errorCode, message };
}

// The card's four fields: what the user kept or edited, over what prepare
// stored. Nothing else from the model or the edits survives.
function cardFields(payload, edits) {
  const changes = edits ?? {};
  return {
    to: Array.isArray(changes.to) ? changes.to : payload.to,
    cc: Array.isArray(changes.cc) ? changes.cc : payload.cc,
    subject: typeof changes.subject === "string" ? changes.subject : payload.subject,
    body: typeof changes.body === "string" ? changes.body : payload.body,
  };
}

function createGmailConnector({ api, auth, credentials }) {
  // The bound login's credential, read locally with no refresh and no
  // network call — the same identity check auth.getAccessToken makes
  // before it ever refreshes. Used only to size-check a message before
  // prepare or commit touch Google at all: a body that is already too
  // large to send is refused without a token refresh in between. Null
  // when the binding is stale (reconnect, disconnect, none at all), in
  // which case getAccessToken(binding) fails the same way, also without
  // any network call.
  function boundCredential(binding) {
    const entry = credentials.read(binding?.ownerAccountId ?? null, "gmail");
    if (
      !entry ||
      entry.generation !== binding?.generation ||
      entry.credential.sub !== binding?.accountId
    ) {
      return null;
    }
    return entry.credential;
  }

  // Gmail refusing a token it just issued means the login itself is gone.
  function refusedAgain(binding) {
    return { ok: false, outcome: "failed", errorCode: auth.markReconnect(binding).errorCode };
  }

  // 403 insufficientPermissions: the grant no longer covers gmail.send.
  function withReconnect(result, binding) {
    return !result.ok && result.errorCode === "reconnect_needed" ? refusedAgain(binding) : result;
  }

  // A 401 means Gmail refused the request, so it sent nothing: it is the one
  // send that may be repeated, once, after refreshing the login the action
  // is bound to. Never whichever login is current.
  async function sendWithRefresh(raw, binding, access) {
    const first = await api.sendMessage({ accessToken: access.token, raw });
    if (first.ok || first.errorCode !== "unauthorized") {
      return { result: withReconnect(first, binding), access };
    }
    const refreshed = await auth.getAccessToken(binding, { forceRefresh: true });
    if (!refreshed.ok) {
      return { result: { ok: false, outcome: "failed", errorCode: refreshed.errorCode }, access };
    }
    const second = await api.sendMessage({ accessToken: refreshed.token, raw });
    if (!second.ok && second.errorCode === "unauthorized") {
      return { result: refusedAgain(binding), access: refreshed };
    }
    return { result: withReconnect(second, binding), access: refreshed };
  }

  return {
    id: "gmail",
    actions: {
      send: {
        kind: "approval",
        editable: { to: "addresses", cc: "addresses", subject: "line", body: "text" },
      },
    },

    async getStatus() {
      const entry = credentials.read(credentials.activeAccountId(), "gmail");
      // A login left by a build that had a Google client still shows, so
      // Disconnect stays available (spec §4.1).
      if (entry) return { ...auth.statusOf(entry.credential), configured: true };
      return {
        connected: false,
        configured: auth.isConfigured(),
        accountLabel: null,
        workspaceLabel: null,
        needsReconnect: false,
      };
    },

    async getBinding() {
      const ownerAccountId = credentials.activeAccountId();
      const entry = credentials.read(ownerAccountId, "gmail");
      if (!entry) return null;
      return { ownerAccountId, accountId: entry.credential.sub, generation: entry.generation };
    },

    async prepare(action, args, { binding } = {}) {
      if (action !== "send") return prepareFailed("unknown_action", "Unknown Gmail action.");
      const recipients = normalizeRecipients({ to: args?.to, cc: args?.cc });
      if (recipients.invalid.length > 0) {
        return clarify(
          `${recipients.invalid[0]} isn't a valid email address. Ask the user for the right one.`
        );
      }
      if (recipients.to.length === 0) return clarify("Ask the user who to send this email to.");
      if (recipients.to.length + recipients.cc.length > MAX_RECIPIENTS) {
        return prepareFailed("too_many_recipients");
      }
      // A subject is one header line: line breaks become spaces, as in the
      // compose path.
      const subject =
        typeof args?.subject === "string" ? args.subject.replace(/[\r\n]+/g, " ") : "";
      if (characterCount(subject) > MAX_SUBJECT_LENGTH) return prepareFailed("too_long");
      const body = typeof args?.body === "string" ? args.body : "";

      // The 1 MB cap is checked before any network call, including a token
      // refresh: the bound login's stored email (no refresh) builds the
      // message for sizing whenever the binding is still live.
      const boundEmail = boundCredential(binding)?.email ?? null;
      if (boundEmail) {
        const sizeCheck = buildRawMessage({
          from: boundEmail,
          to: recipients.to,
          cc: recipients.cc,
          subject,
          body,
        });
        if (!sizeCheck.ok) return prepareFailed(sizeCheck.errorCode);
      }

      const access = await auth.getAccessToken(binding);
      if (!access.ok) return prepareFailed(access.errorCode);
      const { email } = access.credential;
      // A stale binding (boundEmail null) still needs the size check, now
      // that a token was fetched under the login it actually resolved to.
      if (!boundEmail) {
        const built = buildRawMessage({
          from: email,
          to: recipients.to,
          cc: recipients.cc,
          subject,
          body,
        });
        if (!built.ok) return prepareFailed(built.errorCode);
      }

      const fields = { to: recipients.to, cc: recipients.cc, subject, body };
      return {
        status: "ready",
        payload: fields,
        preview: {
          verbKey: "email",
          destinationLabel: recipientsLabel(recipients.to, recipients.cc),
          accountLabel: email,
          body,
          fields: { ...fields, to: [...fields.to], cc: [...fields.cc] },
        },
      };
    },

    async commit(action, payload, edits, { binding } = {}) {
      if (action !== "send") return commitFailed("unknown_action", "Unknown Gmail action.");
      const fields = cardFields(payload, edits);
      // Every check from prepare again, before anything reaches Google.
      const recipients = normalizeRecipients(fields);
      if (recipients.invalid.length > 0) {
        return commitFailed(
          "invalid_recipients",
          `${recipients.invalid[0]} isn't a valid email address, so nothing was sent.`
        );
      }
      if (recipients.to.length === 0) {
        return commitFailed("invalid_recipients", "The email has no recipient in To.");
      }
      if (recipients.to.length + recipients.cc.length > MAX_RECIPIENTS) {
        return commitFailed("too_many_recipients");
      }
      if (LINE_BREAK.test(fields.subject)) {
        return commitFailed("invalid_message", "The subject must be a single line.");
      }
      if (characterCount(fields.subject) > MAX_SUBJECT_LENGTH) return commitFailed("too_long");

      // The 1 MB cap is checked before any network call, including a token
      // refresh: the bound login's stored email (no refresh) builds the
      // message that will actually be sent, whenever the binding is still
      // live, so an oversized edited body never reaches auth.getAccessToken.
      const boundEmail = boundCredential(binding)?.email ?? null;
      let built = boundEmail
        ? buildRawMessage({
            from: boundEmail,
            to: recipients.to,
            cc: recipients.cc,
            subject: fields.subject,
            body: fields.body,
          })
        : null;
      if (built && !built.ok) return commitFailed(built.errorCode);

      const access = await auth.getAccessToken(binding);
      if (!access.ok) return commitFailed(access.errorCode);
      // A stale binding (boundEmail null) still needs the size check, now
      // that a token was fetched under the login it actually resolved to.
      if (!built) {
        built = buildRawMessage({
          from: access.credential.email,
          to: recipients.to,
          cc: recipients.cc,
          subject: fields.subject,
          body: fields.body,
        });
        if (!built.ok) return commitFailed(built.errorCode);
      }

      const sent = await sendWithRefresh(built.raw, binding, access);
      const { result } = sent;
      const { email } = sent.access.credential;
      const label = recipientsLabel(recipients.to, recipients.cc);
      if (result.ok)
        return { state: "sent", url: sentMessageUrl(email, result.id), destinationLabel: label };
      if (result.outcome === "failed") return commitFailed(result.errorCode);
      // Gmail has no idempotency key, so an uncertain send is never repeated.
      return {
        state: "unknown",
        errorCode: result.errorCode,
        checkUrl: sentFolderUrl(email),
        destinationLabel: label,
      };
    },

    authorize: (options) => auth.authorize(options),
    revoke: (credential, options) => auth.revoke(credential, options),
  };
}

module.exports = {
  createGmailConnector,
  normalizeRecipients,
  sentMessageUrl,
  sentFolderUrl,
  MAX_RECIPIENTS,
  MAX_SUBJECT_LENGTH,
};
