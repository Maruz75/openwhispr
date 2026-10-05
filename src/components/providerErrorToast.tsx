import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { ToastActionButton } from "./ui/Toast";
import type { TechnicalErrorDetailsData } from "./ui/useToast";
import { describeProviderError, openProviderSettings } from "../utils/describeProviderError";

export interface ProviderErrorToastProps {
  description: string;
  technicalDetails?: TechnicalErrorDetailsData;
  action?: ReactNode;
}

/** Description, details and Open Settings button for a standard toast. */
export function providerErrorToastProps(error: unknown, t: TFunction): ProviderErrorToastProps {
  const { description, technicalDetails, settingsTarget } = describeProviderError(error, t);
  return {
    description,
    ...(technicalDetails ? { technicalDetails } : {}),
    ...(settingsTarget
      ? {
          action: (
            <ToastActionButton onClick={() => openProviderSettings(settingsTarget)}>
              {t("providerErrors.openSettings")}
            </ToastActionButton>
          ),
        }
      : {}),
  };
}
