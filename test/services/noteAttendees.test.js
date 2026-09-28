const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/utils/noteAttendees.ts");

test("a note's participants column parses to its attendees", async () => {
  const { parseNoteParticipants } = await load();
  const dana = {
    email: "dana@example.com",
    displayName: "Dana",
    responseStatus: null,
    self: false,
  };
  assert.deepEqual(parseNoteParticipants(JSON.stringify([dana])), [dana]);
});

test("a missing, malformed or non-list participants column is no attendees", async () => {
  const { parseNoteParticipants } = await load();
  for (const raw of [null, undefined, "", "not json", "{}", '"dana@example.com"', "null"]) {
    assert.deepEqual(parseNoteParticipants(raw), [], String(raw));
  }
  // Entries without an address are dropped; the rest survive.
  assert.deepEqual(
    parseNoteParticipants(
      JSON.stringify([null, "x", { displayName: "No address" }, { email: "a@b.c" }])
    ),
    [{ email: "a@b.c" }]
  );
});

test("the attendee block lists each person once per line, with the recipient rules", async () => {
  const { noteAttendeesContext } = await load();
  const block = noteAttendeesContext([
    { name: "Dana Wu", email: "dana@example.com" },
    { name: null, email: "kim@example.com" },
  ]);
  const lines = block.split("\n");

  assert.match(lines[0], /^Meeting attendees/);
  assert.equal(lines[1], "- Dana Wu <dana@example.com>");
  assert.equal(lines[2], "- kim@example.com");
  assert.match(block, /"everyone" or "the attendees", use every attendee listed here/);
  assert.match(block, /first name that matches exactly one attendee/);
  assert.match(block, /For anyone else, call find_contact/);
});

test("no attendees means no block at all", async () => {
  const { noteAttendeesContext } = await load();
  assert.equal(noteAttendeesContext([]), "");
});

const attendee = (email, self = false) => ({
  email,
  displayName: null,
  responseStatus: null,
  self,
});

test("on the user's own note, the recorder's self flag stays and their own address is dropped", async () => {
  const { attendeesForUser } = await load();
  const list = [
    attendee("me@corp.test", true),
    attendee("dana@corp.test"),
    attendee("Me@Home.test"),
  ];

  assert.deepEqual(attendeesForUser(list, { ownNote: true, selfEmail: " me@home.test " }), [
    attendee("me@corp.test", true),
    attendee("dana@corp.test"),
  ]);
});

test("on someone else's note, whoever recorded it is an attendee and the viewer is not", async () => {
  const { attendeesForUser } = await load();
  // Alice recorded the meeting, so her copy flags her as self; Chad opens it
  // from a team space.
  const list = [attendee("alice@corp.test", true), attendee("chad@corp.test")];

  assert.deepEqual(attendeesForUser(list, { ownNote: false, selfEmail: "chad@corp.test" }), [
    attendee("alice@corp.test", false),
  ]);
});

test("without a signed-in address, nobody is dropped for it", async () => {
  const { attendeesForUser } = await load();
  const list = [attendee("dana@corp.test")];
  assert.deepEqual(attendeesForUser(list, { ownNote: true, selfEmail: null }), list);
  assert.deepEqual(attendeesForUser(list, { ownNote: true, selfEmail: "" }), list);
});
