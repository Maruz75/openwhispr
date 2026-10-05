import type { TFunction } from "i18next";
import type { TechnicalErrorDetailsData } from "../components/ui/useToast";
import { isProviderSettingsTarget } from "../helpers/providerHttpErrors.js";

export type ProviderSettingsTarget = "speechToText" | "llms";

interface DescribableError {
  message?: string;
  code?: string;
  surface?: string;
  messageKey?: string;
  messageParams?: Record<string, string | number | boolean>;
  settingsTarget?: string;
  technicalDetails?: TechnicalErrorDetailsData;
}

export interface ProviderErrorDescription {
  description: string;
  technicalDetails?: TechnicalErrorDetailsData;
  settingsTarget?: ProviderSettingsTarget;
}

/** One rendering of a (possibly classified) error for every surface. */
export function describeProviderError(error: unknown, t: TFunction): ProviderErrorDescription {
  if (typeof error === "string") return { description: error };
  const source = (error ?? {}) as DescribableError;
  const params = source.messageParams?.selfHosted
    ? { ...source.messageParams, provider: t("providerErrors.selfHostedName") }
    : source.messageParams;
  const description = source.messageKey
    ? String(t(source.messageKey, params))
    : source.message || "";
  const settingsTarget = isProviderSettingsTarget(source.settingsTarget)
    ? (source.settingsTarget as ProviderSettingsTarget)
    : undefined;
  return {
    description,
    ...(source.technicalDetails ? { technicalDetails: source.technicalDetails } : {}),
    ...(settingsTarget ? { settingsTarget } : {}),
  };
}

/** Surface title for a classified provider failure; undefined keeps the caller's own. */
export function providerErrorTitle(
  error: { code?: string; surface?: string } | null | undefined,
  t: TFunction
): string | undefined {
  const code = error?.code;
  // The rate-limit pill keeps its dedicated "Provider Rate Limited" title.
  if (!code?.startsWith("PROVIDER_") || code === "PROVIDER_RATE_LIMITED") return undefined;
  return String(
    t(error?.surface === "llm" ? "providerErrors.titles.llm" : "providerErrors.titles.transcription")
  );
}

export function formatProviderErrorDetails(details: TechnicalErrorDetailsData, t: TFunction): string {
  const isProvider = Boolean(details.provider);
  return [
    details.provider ? `${t("providerErrors.details.provider")}: ${details.provider}` : "",
    details.status !== undefined
      ? `${t("reasoning.enterprise.technicalDetails.httpStatus")}: ${details.status}`
      : "",
    details.exceptionType
      ? `${t("reasoning.enterprise.technicalDetails.awsException")}: ${details.exceptionType}`
      : "",
    details.requestId
      ? `${t(
          isProvider
            ? "providerErrors.details.requestId"
            : "reasoning.enterprise.technicalDetails.awsRequestId"
        )}: ${details.requestId}`
      : "",
    details.underlyingError
      ? `${t("reasoning.enterprise.technicalDetails.underlyingError")}: ${details.underlyingError}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function openProviderSettings(target: ProviderSettingsTarget): void {
  void window.electronAPI?.openSettingsSection?.(target);
}
