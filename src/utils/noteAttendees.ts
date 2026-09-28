import type { CalendarAttendee } from "../types/calendar";
import type { NoteAttendee } from "../types/connectors";

function isAttendee(value: unknown): value is CalendarAttendee {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { email?: unknown }).email === "string"
  );
}

/** A note's `participants` column (JSON), or [] when it is missing or malformed. */
export function parseNoteParticipants(raw: string | null | undefined): CalendarAttendee[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isAttendee) : [];
  } catch {
    return [];
  }
}

/**
 * The note chat's "Meeting attendees" block: the people main kept (never the
 * user or a room), and how to read "everyone" or a first name. Empty when
 * nobody is left, so a note without attendees adds nothing.
 */
export function noteAttendeesContext(attendees: NoteAttendee[]): string {
  if (attendees.length === 0) return "";
  const lines = attendees.map(({ name, email }) => (name ? `- ${name} <${email}>` : `- ${email}`));
  return [
    "Meeting attendees (the user and meeting rooms are not listed):",
    ...lines,
    'When the user says "everyone" or "the attendees", use every attendee listed here. A first name that matches exactly one attendee means that attendee. For anyone else, call find_contact.',
  ].join("\n");
}
