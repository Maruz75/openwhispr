import {
  attendeeName,
  formatAttendeeChipLabel,
  formatNoteMetaDate,
  sortAttendees,
} from '@/lib/notes/noteMeta';
import type { CalendarParticipant } from '@/data/calendarTypes';

const person = (overrides: Partial<CalendarParticipant> = {}): CalendarParticipant => ({
  email: null,
  displayName: null,
  responseStatus: 'accepted',
  optional: false,
  organizer: false,
  resource: false,
  self: false,
  ...overrides,
});

// SQLite stores created_at as a UTC "YYYY-MM-DD HH:MM:SS" string.
const toSqlite = (date: Date): string => date.toISOString().replace('T', ' ').slice(0, 19);

describe('formatNoteMetaDate', () => {
  const now = new Date(2026, 8, 27, 15, 0);

  it('labels a note created today with its time', () => {
    expect(formatNoteMetaDate(toSqlite(new Date(2026, 8, 27, 9, 27)), now)).toMatch(/^Today .*27/);
  });

  it('labels a note created yesterday', () => {
    expect(formatNoteMetaDate(toSqlite(new Date(2026, 8, 26, 14, 5)), now)).toMatch(
      /^Yesterday .*05/,
    );
  });

  it('shows month and day for an earlier date this year', () => {
    const label = formatNoteMetaDate(toSqlite(new Date(2026, 8, 21, 9, 27)), now);
    expect(label).toMatch(/^Sep 21, /);
    expect(label).not.toContain('2026');
  });

  it('adds the year for an earlier year', () => {
    expect(formatNoteMetaDate(toSqlite(new Date(2025, 8, 21, 9, 27)), now)).toContain('2025');
  });

  it('returns an empty label when the timestamp is missing or unparsable', () => {
    expect(formatNoteMetaDate(null, now)).toBe('');
    expect(formatNoteMetaDate('not a date', now)).toBe('');
  });
});

describe('sortAttendees', () => {
  it('drops rooms and puts the organizer first', () => {
    const sam = person({ displayName: 'Sam Lee' });
    const room = person({ displayName: 'Board Room', resource: true });
    const ana = person({ displayName: 'Ana Ruiz', organizer: true });
    expect(sortAttendees([sam, room, ana])).toEqual([ana, sam]);
  });
});

describe('attendeeName', () => {
  it('prefers the display name, then the email, then Guest', () => {
    expect(attendeeName(person({ displayName: ' Sam Lee ', email: 'sam@x.com' }))).toBe('Sam Lee');
    expect(attendeeName(person({ email: 'sam@x.com' }))).toBe('sam@x.com');
    expect(attendeeName(person())).toBe('Guest');
  });

  it('calls your own row You', () => {
    expect(attendeeName(person({ displayName: 'Me Myself', self: true }))).toBe('You');
  });
});

describe('formatAttendeeChipLabel', () => {
  it('names the first attendee who is not you, by first name, with a count of the rest', () => {
    const label = formatAttendeeChipLabel([
      person({ displayName: 'Me', self: true }),
      person({ displayName: 'Sam Lee' }),
      person({ displayName: 'Ana Ruiz' }),
      person({ email: 'kim@x.com' }),
    ]);
    expect(label).toBe('Sam +3');
  });

  it('starts from the organizer', () => {
    expect(
      formatAttendeeChipLabel([
        person({ displayName: 'Sam Lee' }),
        person({ displayName: 'Ana Ruiz', organizer: true }),
      ]),
    ).toBe('Ana +1');
  });

  it('omits the count for a single attendee', () => {
    expect(formatAttendeeChipLabel([person({ displayName: 'Sam Lee' })])).toBe('Sam');
  });

  it('falls back to the email local part when there is no name', () => {
    expect(formatAttendeeChipLabel([person({ email: 'kim@x.com' })])).toBe('kim');
  });

  it('reads You when you are the only person', () => {
    expect(formatAttendeeChipLabel([person({ self: true, displayName: 'Me' })])).toBe('You');
  });

  it('returns null when there are no people, only rooms', () => {
    expect(formatAttendeeChipLabel([])).toBeNull();
    expect(formatAttendeeChipLabel([person({ displayName: 'Room', resource: true })])).toBeNull();
  });
});
