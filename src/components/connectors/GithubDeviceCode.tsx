import { useEffect, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import type { ConnectorConnectProgress } from "../../types/connectors";

/** GitHub's page for entering a device code. */
export const GITHUB_DEVICE_URL = "https://github.com/login/device";

// The code is only ever entered on github.com, whatever the payload says.
function deviceUrl(verificationUri: string): string {
  return verificationUri.startsWith("https://github.com/") ? verificationUri : GITHUB_DEVICE_URL;
}

/**
 * The code GitHub's device flow asks the user to enter, shown in the row
 * while it connects. Mounted only while the row is connecting, so it
 * listens only then; the latest code for this connector wins, since a new
 * Connect replaces the attempt before it.
 */
export function GithubDeviceCode({ connectorId }: { connectorId: string }): ReactElement | null {
  const { t, i18n } = useTranslation();
  const [progress, setProgress] = useState<ConnectorConnectProgress | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onConnectorConnectProgress?.((next) => {
      if (next?.connectorId === connectorId) setProgress(next);
    });
    return () => unsubscribe?.();
  }, [connectorId]);

  if (!progress) return null;
  const { userCode, verificationUri, expiresAt } = progress;

  // GitHub's page opens even when the copy fails: the code is on screen to type.
  const copyAndOpen = async (): Promise<void> => {
    try {
      const result = await window.electronAPI?.writeClipboard?.(userCode);
      if (result?.success) setCopiedCode(userCode);
    } catch {
      // Nothing to undo; the code stays visible.
    }
    void window.electronAPI?.openExternal?.(deviceUrl(verificationUri));
  };

  const expiry = new Intl.DateTimeFormat(i18n.language, {
    hour: "numeric",
    minute: "2-digit",
  }).format(expiresAt);

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {t("connectors.github.deviceCode.instructions")}
      </p>
      <p
        className="font-mono text-lg font-semibold tracking-[0.2em] text-foreground select-all"
        dir="ltr"
      >
        {userCode}
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void copyAndOpen()}>
          {t("connectors.github.deviceCode.copyAndOpen")}
        </Button>
        {/* Stops main's polling at once; the row then reads as before Connect. */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void window.electronAPI?.connectorCancelConnect?.(connectorId)}
        >
          {t("connectors.github.deviceCode.cancel")}
        </Button>
        {copiedCode === userCode && (
          <span role="status" className="text-xs text-muted-foreground">
            {t("connectors.github.deviceCode.copied")}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground/70">
        {t("connectors.github.deviceCode.expires", { time: expiry })}
      </p>
    </div>
  );
}
