import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { bareEmailAddress, isValidEmailAddress } from "../../helpers/connectors/emailCompose";

/** An email card's fields, exactly as Send commits them. */
export interface EmailFields {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
}

/**
 * The addresses in a comma-separated To or Cc input, in order. Each is kept
 * as typed, so a bad one is named on the card instead of silently dropped.
 */
export function parseAddressList(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * What blocks Send. A display-name form ("Josh <josh@acme.com>") counts as
 * invalid too: main would send to the bare address, which isn't what the
 * card shows.
 */
export function emailFieldProblems(fields: EmailFields): { invalid: string[]; missingTo: boolean } {
  const invalid = [...fields.to, ...fields.cc].filter(
    (address) =>
      bareEmailAddress(address) !== address.normalize("NFC") || !isValidEmailAddress(address)
  );
  return { invalid, missingTo: fields.to.length === 0 };
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

// A subject is one header line. A pasted line break becomes a space here,
// so the card never shows a subject main would refuse to send.
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

const FIELD_CLASS = "w-full rounded-md border border-border/70 bg-background px-2 py-1";
const LABEL_CLASS = "w-14 shrink-0 text-xs text-muted-foreground";

interface EmailApprovalFieldsProps {
  fields: EmailFields;
  editing: boolean;
  disabled: boolean;
  onChange: (patch: Partial<EmailFields>) => void;
}

// Mounted only while editing, so every edit session starts from the draft.
function EmailFieldsEditor({
  fields,
  disabled,
  onChange,
}: Omit<EmailApprovalFieldsProps, "editing">): ReactElement {
  const { t } = useTranslation();
  // To and Cc are edited as text: re-joining the parsed list on every
  // keystroke would swallow the comma the user just typed.
  const [toText, setToText] = useState(() => fields.to.join(", "));
  const [ccText, setCcText] = useState(() => fields.cc.join(", "));

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2">
        <span className={LABEL_CLASS}>{t("connectors.approval.email.toLabel")}</span>
        <input
          aria-label={t("connectors.approval.email.toLabel")}
          type="text"
          className={FIELD_CLASS}
          dir="auto"
          disabled={disabled}
          value={toText}
          onChange={(event) => {
            setToText(event.target.value);
            onChange({ to: parseAddressList(event.target.value) });
          }}
        />
      </label>
      <label className="flex items-center gap-2">
        <span className={LABEL_CLASS}>{t("connectors.approval.email.ccLabel")}</span>
        <input
          aria-label={t("connectors.approval.email.ccLabel")}
          type="text"
          className={FIELD_CLASS}
          dir="auto"
          disabled={disabled}
          value={ccText}
          onChange={(event) => {
            setCcText(event.target.value);
            onChange({ cc: parseAddressList(event.target.value) });
          }}
        />
      </label>
      <p className="text-xs text-muted-foreground">{t("connectors.approval.email.addressHint")}</p>
      <label className="flex items-center gap-2">
        <span className={LABEL_CLASS}>{t("connectors.approval.email.subjectLabel")}</span>
        <input
          aria-label={t("connectors.approval.email.subjectLabel")}
          type="text"
          className={FIELD_CLASS}
          dir="auto"
          disabled={disabled}
          value={fields.subject}
          onChange={(event) => onChange({ subject: singleLine(event.target.value) })}
        />
      </label>
      <textarea
        aria-label={t("connectors.approval.email.bodyLabel")}
        className={`min-h-24 ${FIELD_CLASS}`}
        dir="auto"
        disabled={disabled}
        value={fields.body}
        onChange={(event) => onChange({ body: event.target.value })}
      />
    </div>
  );
}

function EmailFieldsView({ fields }: { fields: EmailFields }): ReactElement {
  const { t } = useTranslation();
  const rows: Array<[string, string]> = [
    ["toLabel", fields.to.join(", ")],
    ...(fields.cc.length > 0 ? [["ccLabel", fields.cc.join(", ")] as [string, string]] : []),
    ["subjectLabel", fields.subject],
  ];
  return (
    <div>
      <dl className="space-y-0.5">
        {rows.map(([labelKey, value]) => (
          <div key={labelKey} className="flex gap-2">
            <dt className={LABEL_CLASS}>{t(`connectors.approval.email.${labelKey}`)}</dt>
            <dd className="min-w-0 break-words" dir="auto">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 whitespace-pre-wrap" dir="auto">
        {fields.body}
      </p>
    </div>
  );
}

/** The email card's To, Cc, Subject and Body, shown or edited. */
export function EmailApprovalFields({
  fields,
  editing,
  disabled,
  onChange,
}: EmailApprovalFieldsProps): ReactElement {
  return editing ? (
    <EmailFieldsEditor fields={fields} disabled={disabled} onChange={onChange} />
  ) : (
    <EmailFieldsView fields={fields} />
  );
}
