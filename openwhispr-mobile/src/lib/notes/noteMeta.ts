import type { CalendarParticipant } from '@/data/calendarTypes';
import { tryParseNoteTimestamp } from '@/lib/parseNoteTimestamp';

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * When the note was taken. Notes pulled before `created_at` synced were stamped with the pull
 * time, which is later than their last edit, so the earlier of the two is the closer answer.
 */
export function noteTakenAt(
  createdAt: string | null | undefined,
  updatedAt: string | null | undefined,
): Date | null {
  const created = tryParseNoteTimestamp(createdAt);
  const updated = tryParseNoteTimestamp(updatedAt);
  if (!created || !updated) return created ?? updated;
  return created < updated ? created : updated;
}

/** "Today 9:27 AM", "Yesterday 2:05 PM", "Sep 21, 9:27 AM", or "Sep 21, 2025, 9:27 AM". */
export function formatNoteMetaDate(timestamp: string | Date | null | undefined, now: Date): string {
  const date = tryParseNoteTimestamp(timestamp);
  if (!date) return '';

  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (isSameDay(date, now)) return `Today ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return `Yesterday ${time}`;

  const day = date.toLocaleDateString(
    undefined,
    date.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  );
  return `${day}, ${time}`;
}

/** People only (rooms dropped), organizer first, otherwise in calendar order. */
export function sortAttendees(participants: CalendarParticipant[]): CalendarParticipant[] {
  const people = participants.filter((participant) => !participant.resource);
  return [
    ...people.filter((participant) => participant.organizer),
    ...people.filter((participant) => !participant.organizer),
  ];
}

export function attendeeName(participant: CalendarParticipant): string {
  if (participant.self) return 'You';
  return participant.displayName?.trim() || participant.email || 'Guest';
}

const attendeeFirstName = (participant: CalendarParticipant): string =>
  participant.displayName?.trim().split(/\s+/)[0] || participant.email?.split('@')[0] || 'Guest';

/** "Sam +3": the first attendee who isn't you, plus everyone else. Null when nobody attends. */
export function formatAttendeeChipLabel(participants: CalendarParticipant[]): string | null {
  const people = sortAttendees(participants);
  if (people.length === 0) return null;

  const first = people.find((participant) => !participant.self);
  if (!first) return 'You';

  const others = people.length - 1;
  const name = attendeeFirstName(first);
  return others > 0 ? `${name} +${others}` : name;
}
