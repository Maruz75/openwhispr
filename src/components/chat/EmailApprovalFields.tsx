import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { recipientLabel } from "../../helpers/connectors/emailCompose";
import {
  parseAddressList,
  type EmailFieldProblems,
  type EmailFields,
} from "../../utils/emailApprovalFields";

// A subject is one header line. A pasted line break becomes a space here,
// so the card never shows a subject main would refuse to send.
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

const FIELD_CLASS = "w-full rounded-md border border-border/70 bg-background px-2 py-1";
const LABEL_CLASS = "w-14 shrink-0 text-xs text-muted-foreground";

interface EmailApprovalFieldsProps {
  fields: EmailFields;
  /** True only while a pending card is being edited, so the inputs are never disabled. */
  editing: boolean;
  /** What blocks Send, and the id of the text that says why. */
  problems: EmailFieldProblems | null;
  problemsId: string;
  onChange: (patch: Partial<EmailFields>) => void;
}

// Which fields a problem is about, for aria-invalid.
function invalidFields(
  fields: EmailFields,
  problems: EmailFieldProblems | null
): { to: boolean; cc: boolean; subject: boolean; body: boolean } {
  const hasInvalid = (list: string[]): boolean =>
    Boolean(problems && list.some((address) => problems.invalid.includes(address)));
  const tooMany = Boolean(problems?.tooManyRecipients);
  return {
    to: hasInvalid(fields.to) || Boolean(problems?.missingTo) || tooMany,
    cc: hasInvalid(fields.cc) || tooMany,
    subject: Boolean(problems?.subjectTooLong),
    body: Boolean(problems?.bodyTooLong),
  };
}

// Mounted only while editing, so every edit session starts from the draft.
function EmailFieldsEditor({
  fields,
  problems,
  problemsId,
  onChange,
}: Omit<EmailApprovalFieldsProps, "editing">): ReactElement {
  const { t } = useTranslation();
  const invalid = invalidFields(fields, problems);
  const validity = (isInvalid: boolean): { "aria-invalid"?: true; "aria-describedby"?: string } =>
    isInvalid ? { "aria-invalid": true, "aria-describedby": problemsId } : {};
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
          {...validity(invalid.to)}
          type="text"
          className={FIELD_CLASS}
          dir="auto"
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
          {...validity(invalid.cc)}
          type="text"
          className={FIELD_CLASS}
          dir="auto"
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
          {...validity(invalid.subject)}
          type="text"
          className={FIELD_CLASS}
          dir="auto"
          value={fields.subject}
          onChange={(event) => onChange({ subject: singleLine(event.target.value) })}
        />
      </label>
      <textarea
        aria-label={t("connectors.approval.email.bodyLabel")}
        {...validity(invalid.body)}
        className={`min-h-24 ${FIELD_CLASS}`}
        dir="auto"
        value={fields.body}
        onChange={(event) => onChange({ body: event.target.value })}
      />
    </div>
  );
}

function EmailFieldsView({ fields }: { fields: EmailFields }): ReactElement {
  const { t } = useTranslation();
  // Display only: a non-ASCII domain also shows the punycode form it
  // routes to (recipientLabel), same as destinationLabel and the tool
  // step, so a single-script look-alike domain doesn't pass as the real
  // one. Editing still reads and writes the raw address.
  const rows: Array<[string, string]> = [
    ["toLabel", fields.to.map(recipientLabel).join(", ")],
    ...(fields.cc.length > 0
      ? [["ccLabel", fields.cc.map(recipientLabel).join(", ")] as [string, string]]
      : []),
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
  problems,
  problemsId,
  onChange,
}: EmailApprovalFieldsProps): ReactElement {
  return editing ? (
    <EmailFieldsEditor
      fields={fields}
      problems={problems}
      problemsId={problemsId}
      onChange={onChange}
    />
  ) : (
    <EmailFieldsView fields={fields} />
  );
}
