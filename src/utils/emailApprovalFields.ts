import {
  bareEmailAddress,
  isValidEmailAddress,
  MAX_EMAIL_RECIPIENTS,
  MAX_EMAIL_SUBJECT_LENGTH,
} from "../helpers/connectors/emailCompose";

/** An email card's fields, exactly as Send commits them. */
export interface EmailFields {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
}

/** What blocks Send, in the order the card names it. */
export interface EmailFieldProblems {
  invalid: string[];
  missingTo: boolean;
  tooManyRecipients: boolean;
  subjectTooLong: boolean;
}

// Commas as typed in every locale (Arabic ، and the CJK fullwidth ， and 、),
// and the semicolons Outlook users type between addresses.
const ADDRESS_SEPARATOR = /[,;،，、]/;

/**
 * The addresses in a To or Cc input, in order. Each is kept as typed, so a
 * bad one is named on the card instead of silently dropped.
 */
export function parseAddressList(text: string): string[] {
  return text
    .split(ADDRESS_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * What blocks Send. A display-name form ("Josh <josh@acme.com>") counts as
 * invalid too: main would send to the bare address, which isn't what the
 * card shows. The limits are main's, so a card never ends in a failure the
 * user could have fixed.
 */
export function emailFieldProblems(fields: EmailFields): EmailFieldProblems {
  const all = [...fields.to, ...fields.cc];
  const invalid = all.filter(
    (address) =>
      bareEmailAddress(address) !== address.normalize("NFC") || !isValidEmailAddress(address)
  );
  // Main sends each address once, however often the card lists it.
  const recipients = new Set(all.map((address) => address.toLowerCase())).size;
  return {
    invalid,
    missingTo: fields.to.length === 0,
    tooManyRecipients: recipients > MAX_EMAIL_RECIPIENTS,
    subjectTooLong: [...fields.subject].length > MAX_EMAIL_SUBJECT_LENGTH,
  };
}

export function hasEmailFieldProblem(problems: EmailFieldProblems): boolean {
  return (
    problems.invalid.length > 0 ||
    problems.missingTo ||
    problems.tooManyRecipients ||
    problems.subjectTooLong
  );
}

/** The email layout's fields, read from a draft's generic fields map. */
export function toEmailFields(fields: Record<string, string | string[]>): EmailFields {
  const list = (value: string | string[] | undefined): string[] =>
    Array.isArray(value) ? value : [];
  const text = (value: string | string[] | undefined): string =>
    typeof value === "string" ? value : "";
  return {
    to: list(fields.to),
    cc: list(fields.cc),
    subject: text(fields.subject),
    body: text(fields.body),
  };
}
