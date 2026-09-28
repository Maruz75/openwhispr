import type { ReactElement } from "react";
import gmailMark from "../../assets/icons/gmail.svg";
import { ConnectorLoginRow } from "./ConnectorLoginRow";
import type { ConnectorStatus } from "../../types/connectors";

interface GmailConnectorRowProps {
  isPaid: boolean;
  blockedByOrg: boolean;
  onUpgrade: () => void;
}

const gmailAccountSummary = (status: ConnectorStatus): Record<string, string> => ({
  account: status.accountLabel ?? "",
});

export function GmailConnectorRow({
  isPaid,
  blockedByOrg,
  onUpgrade,
}: GmailConnectorRowProps): ReactElement | null {
  return (
    <ConnectorLoginRow
      connectorId="gmail"
      isPaid={isPaid}
      blockedByOrg={blockedByOrg}
      onUpgrade={onUpgrade}
      accountSummary={gmailAccountSummary}
      // Gmail's mark, like the calendar rows' brand marks: the generic
      // envelope is the "Email drafts" row just above.
      brandIcon
      icon={
        <img
          src={gmailMark}
          alt=""
          aria-hidden="true"
          width={20}
          height={15}
          decoding="async"
          draggable={false}
          className="h-[15px] w-5 shrink-0 select-none"
        />
      }
    />
  );
}
