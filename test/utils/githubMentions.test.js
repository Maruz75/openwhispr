const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/utils/githubMentions.ts");

test("finds people and teams, in the order they first appear", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(
    githubMentions("Thanks @alice! Looping in @acme/platform-team and @bob-smith."),
    ["@alice", "@acme/platform-team", "@bob-smith"]
  );
});

test("a name mentioned twice, in any case, is listed once as first written", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(githubMentions("@Alice can you check? cc @bob, @alice, @ALICE"), [
    "@Alice",
    "@bob",
  ]);
});

test("mentions at the start of a line, in brackets and before punctuation count", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(githubMentions("@dana\n(@erin) ping:@finn, @gus.\n- @hal"), [
    "@dana",
    "@erin",
    "@finn",
    "@gus",
    "@hal",
  ]);
});

test("email addresses and @ inside a word are not mentions", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(githubMentions("Mail dana@example.com or ops@acme.io; a@b; x@y.z"), []);
  assert.deepEqual(githubMentions("user@alice"), []);
  // "@@x" and a domain immediately before "@" ("medium.com/@x") still don't
  // count: "@" and "/" stay excluded even though "_", "-", "." and "\\" no
  // longer are.
  assert.deepEqual(githubMentions("a@b.com @@x medium.com/@x"), []);
});

// GitHub renders and notifies through all of these; under-reporting a
// mention it would notify is the mistake to avoid, so any non-word character
// right before "@" now opens one, not only whitespace and a narrower set of
// punctuation.
test("a non-word character right before @ opens a mention, including one that used to be excluded", async () => {
  const { githubMentions } = await load();
  // Markdown italics: GitHub renders `_@gina_` as <em>@gina</em> and notifies
  // gina; the trailing underscore ends the handle rather than blocking it.
  assert.deepEqual(githubMentions("_@gina_"), ["@gina"]);
  // Enterprise Managed User handles carry a "_shortcode" suffix.
  assert.deepEqual(githubMentions("ping @bob_acme"), ["@bob_acme"]);
  assert.deepEqual(githubMentions("hi-@alice"), ["@alice"]);
  // The backslash is dropped when GitHub renders this, and it still notifies.
  assert.deepEqual(githubMentions("see \\@dave"), ["@dave"]);
  // Loosened on purpose: previously excluded as "@ inside a word".
  assert.deepEqual(githubMentions("foo_@bar"), ["@bar"]);
});

test("CRLF line endings are normalised before paragraphs, fences and code spans are found", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(githubMentions("cc @alice\r\n\r\n@bob"), ["@alice", "@bob"]);
  assert.deepEqual(
    githubMentions("Press the ` key to open the console.\r\n\r\ncc @alice, see `main.js`"),
    ["@alice"]
  );
  const body = ["Before @alice", "```js", "// @bob", "```", "After @carol"].join("\r\n");
  assert.deepEqual(githubMentions(body), ["@alice", "@carol"]);
});

test("mentions inside inline code are ignored", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(githubMentions("Run `npm i @types/node` then ask @alice"), ["@alice"]);
  assert.deepEqual(githubMentions("Use ``a ` @inside`` here, @outside"), ["@outside"]);
});

test("a code span never crosses a blank line, so a later paragraph's mention still counts", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(
    githubMentions("Press the ` key to open the console.\n\ncc @alice, the fix is in `main.js`"),
    ["@alice"]
  );
  assert.deepEqual(githubMentions("`@a` then @b"), ["@b"]);
});

test("mentions inside fenced code blocks are ignored, fences of either kind", async () => {
  const { githubMentions } = await load();
  const body = [
    "Before @alice",
    "```js",
    "import x from '@scope/pkg';",
    "// @bob",
    "```",
    "~~~",
    "@carol",
    "~~~",
    "After @dana",
  ].join("\n");
  assert.deepEqual(githubMentions(body), ["@alice", "@dana"]);
});

test("an unclosed fence hides the rest of the text, as GitHub renders it", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(githubMentions("See @alice\n```\n@bob never closed"), ["@alice"]);
});

test("an unclosed backtick is plain text, so its mention counts", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(githubMentions("a stray ` then @alice"), ["@alice"]);
});

test("doubled @ or a bare hyphen right after @ are never mentions; over-long handles aren't either", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(githubMentions("@@bob @-carol"), []);
  assert.deepEqual(githubMentions(`@${"a".repeat(40)}`), []);
  assert.deepEqual(githubMentions(`@${"a".repeat(39)}`), [`@${"a".repeat(39)}`]);
});

test("no text, no mentions", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(githubMentions(""), []);
  assert.deepEqual(githubMentions("Nothing to see here."), []);
});
