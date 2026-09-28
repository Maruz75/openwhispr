const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/utils/emailApprovalFields.ts");

// A right-to-left override, which can make one domain read as another.
const RLO = String.fromCodePoint(0x202e);

const FIELDS = {
  to: ["josh@acme.test", "dana@acme.test"],
  cc: [],
  subject: "Q3 numbers",
  body: "Line one\nLine two",
};
const NO_PROBLEMS = {
  invalid: [],
  missingTo: false,
  tooManyRecipients: false,
  subjectTooLong: false,
};

test("To and Cc are read as the addresses the user typed, empty entries dropped", async () => {
  const { parseAddressList } = await load();
  assert.deepEqual(parseAddressList(" josh@acme.test, ,dana@acme.test ,"), [
    "josh@acme.test",
    "dana@acme.test",
  ]);
  assert.deepEqual(parseAddressList("   "), []);
  // Kept as typed, so the card can name it.
  assert.deepEqual(parseAddressList("Josh <josh@acme.test>, sam"), [
    "Josh <josh@acme.test>",
    "sam",
  ]);
});

test("the commas of every locale, and semicolons, separate addresses", async () => {
  const { parseAddressList } = await load();
  for (const separator of [",", ";", "،", "，", "、"]) {
    assert.deepEqual(
      parseAddressList(`josh@acme.test${separator} dana@acme.test`),
      ["josh@acme.test", "dana@acme.test"],
      separator
    );
  }
});

test("Send is blocked by an empty To and by any address that isn't bare and valid", async () => {
  const { emailFieldProblems } = await load();
  assert.deepEqual(emailFieldProblems(FIELDS), NO_PROBLEMS);
  assert.deepEqual(emailFieldProblems({ ...FIELDS, to: [] }), { ...NO_PROBLEMS, missingTo: true });
  assert.deepEqual(
    emailFieldProblems({
      ...FIELDS,
      to: ["Josh <josh@acme.test>", "josh@acme.test"],
      cc: ["sam", `evil@acme.test${RLO}`, "dana@acme"],
    }),
    {
      ...NO_PROBLEMS,
      invalid: ["Josh <josh@acme.test>", "sam", `evil@acme.test${RLO}`, "dana@acme"],
    }
  );
});

test("Send is blocked past Gmail's limits: 50 recipients, a 250-character subject", async () => {
  const { emailFieldProblems } = await load();
  const addresses = (count, prefix) =>
    Array.from({ length: count }, (_, index) => `${prefix}${index}@acme.test`);

  assert.equal(
    emailFieldProblems({ ...FIELDS, to: addresses(30, "a"), cc: addresses(20, "b") })
      .tooManyRecipients,
    false,
    "50 exactly is allowed"
  );
  assert.equal(
    emailFieldProblems({ ...FIELDS, to: addresses(30, "a"), cc: addresses(21, "b") })
      .tooManyRecipients,
    true
  );
  // Main sends each address once, so a repeat doesn't count twice.
  assert.equal(
    emailFieldProblems({
      ...FIELDS,
      to: addresses(50, "a"),
      cc: ["A0@acme.test"],
    }).tooManyRecipients,
    false
  );

  assert.equal(emailFieldProblems({ ...FIELDS, subject: "x".repeat(250) }).subjectTooLong, false);
  assert.equal(emailFieldProblems({ ...FIELDS, subject: "x".repeat(251) }).subjectTooLong, true);
  // Characters, not UTF-16 units, as main counts them.
  assert.equal(emailFieldProblems({ ...FIELDS, subject: "😀".repeat(250) }).subjectTooLong, false);
});

test("a draft's fields map is read as an email, with anything missing left empty", async () => {
  const { toEmailFields } = await load();
  assert.deepEqual(toEmailFields(FIELDS), FIELDS);
  assert.deepEqual(toEmailFields({ to: "josh@acme.test", subject: ["x"] }), {
    to: [],
    cc: [],
    subject: "",
    body: "",
  });
});
