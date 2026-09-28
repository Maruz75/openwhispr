import type { ReactElement } from "react";
import { Mail } from "../icons";
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
      icon={<Mail className="w-4 h-4 text-primary" aria-hidden="true" />}
    />
  );
}
