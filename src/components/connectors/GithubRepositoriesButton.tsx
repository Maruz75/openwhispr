import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import type { ConnectorStatus } from "../../types/connectors";

/**
 * Opens the GitHub App's install page, where the user picks the
 * repositories the assistant can reach. With none picked yet it is the
 * row's next step, so it reads "Choose repositories" and stands out.
 */
export function GithubRepositoriesButton({
  status,
}: {
  status: ConnectorStatus;
}): ReactElement | null {
  const { t } = useTranslation();
  const { manageUrl } = status;
  // No App slug in this build: there is no page to open.
  if (!manageUrl) return null;
  // Only a count of zero: a count that couldn't be read (null) may still
  // have repositories behind it.
  const none = status.workspaceLabel === "0";
  return (
    <Button
      size="sm"
      variant={none ? "default" : "outline"}
      onClick={() => void window.electronAPI?.openExternal?.(manageUrl)}
    >
      {t(none ? "connectors.github.repositories.choose" : "connectors.github.repositories.manage")}
    </Button>
  );
}
