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
  assert.deepEqual(githubMentions("user@alice and foo_@bar"), []);
});

test("mentions inside inline code are ignored", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(githubMentions("Run `npm i @types/node` then ask @alice"), ["@alice"]);
  assert.deepEqual(githubMentions("Use ``a ` @inside`` here, @outside"), ["@outside"]);
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

test("escaped, doubled or over-long handles are not mentions", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(githubMentions("\\@alice @@bob @-carol"), []);
  assert.deepEqual(githubMentions(`@${"a".repeat(40)}`), []);
  assert.deepEqual(githubMentions(`@${"a".repeat(39)}`), [`@${"a".repeat(39)}`]);
});

test("no text, no mentions", async () => {
  const { githubMentions } = await load();
  assert.deepEqual(githubMentions(""), []);
  assert.deepEqual(githubMentions("Nothing to see here."), []);
});
