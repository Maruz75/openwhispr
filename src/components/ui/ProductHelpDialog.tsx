import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./dialog";
import { Button } from "./button";
import {
  HELP_TOPICS,
  getHelpContext,
  lookupHelp,
  type HelpTopic,
  type HelpResult,
} from "../../services/help/productHelp";
import { markdownToPlainText } from "../../helpers/markdownToPlainText";
import topics from "../../config/productHelpTopics.json";

const labels: Record<string, string> = {
  dictationKey: "settingsPage.general.hotkey.title",
  voiceAgentKey: "settingsPage.general.voiceAgentHotkey.title",
  translationKey: "settingsPage.general.translationHotkey.title",
  meetingKey: "settingsPage.general.meetingHotkey.title",
  activationMode: "settingsPage.general.hotkey.activationMode",
  microphoneSelectionMode: "microphoneSettings.inputDevice",
  selectedMicDeviceLabel: "settingsPage.general.microphone.title",
  microphonePermission: "onboarding.permissions.microphoneTitle",
  systemAudioPermission: "settingsPage.permissions.systemAudioTitle",
  voiceAssistantMode: "settingsPage.llms.tabs.dictationAgent",
  cleanupMode: "settingsPage.llms.tabs.dictationCleanup",
  accessibilityPermission: "onboarding.permissions.accessibilityTitle",
  dictationEngine: "settingsPage.speechToText.tabs.dictation",
  meetingEngine: "settingsPage.speechToText.tabs.noteRecording",
  uploadEngine: "settingsPage.speechToText.tabs.upload",
  transcriptionMode: "settingsPage.speechToText.tabs.dictation",
  meetingTranscriptionMode: "settingsPage.speechToText.tabs.noteRecording",
  uploadTranscriptionMode: "settingsPage.speechToText.tabs.upload",
  chatMode: "settingsPage.llms.tabs.chatIntelligence",
  chatProvider: "settingsPage.llms.title",
  agentAllowed: "productHelp.policy",
  uiLanguage: "settings.language.uiLabel",
  preferredLanguage: "settings.language.transcriptionLabel",
  cloudBackupEnabled: "settingsPage.privacy.cloudBackup",
  gcalConnected: "integrations.googleCalendar.title",
  mcalConnected: "integrations.microsoftCalendar.title",
  appleCalendarConnected: "integrations.appleCalendar.title",
};

export default function ProductHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [topic, setTopic] = useState<HelpTopic>("hotkeys");
  const [result, setResult] = useState<HelpResult | null>(null);
  const [context, setContext] = useState<Awaited<ReturnType<typeof getHelpContext>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setResult(null);
    setContext(null);
    setLoading(true);
    getHelpContext(topic)
      .then((value) => {
        if (!controller.signal.aborted) setContext(value);
      })
      .catch(() => {});
    lookupHelp(topic, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, topic, attempt]);
  const valueLabels: Record<string, string> = {
    tap: "common.tap",
    push: "common.hold",
    local: "common.local",
    system: "microphoneSettings.systemDefault",
    openwhispr: "settingsPage.aiModels.modes.openwhispr",
    providers: "settingsPage.aiModels.modes.providers",
    "self-hosted": "settingsPage.aiModels.modes.selfHosted",
    enterprise: "settingsPage.transcription.modes.enterprise",
    granted: "productHelp.on",
    denied: "productHelp.off",
    restricted: "productHelp.off",
    "not-granted": "productHelp.off",
    "not-determined": "common.unknown",
    "not-applicable": "common.unknown",
    "built-in": "microphoneSettings.builtIn",
    unknown: "common.unknown",
    auto: "notes.upload.numSpeakersPlaceholder",
  };
  const article = topics[topic];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("productHelp.title")}</DialogTitle>
          <DialogDescription>{t("productHelp.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2" aria-label={t("productHelp.topics")}>
          {HELP_TOPICS.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={topic === item ? "secondary" : "ghost"}
              aria-pressed={topic === item}
              onClick={() => setTopic(item)}
            >
              {t(`productHelp.topicsList.${item}`)}
            </Button>
          ))}
        </div>
        <section className="rounded-lg border border-border p-4 space-y-2">
          <h3 className="font-medium text-sm">{t("productHelp.essentials")}</h3>
          <p className="text-sm text-muted-foreground">{article.text}</p>
          <Button
            variant="link"
            className="p-0 h-auto"
            onClick={() =>
              void window.electronAPI.openExternal("https://docs.openwhispr.com" + article.path)
            }
          >
            {t("productHelp.openArticle")}
          </Button>
        </section>
        <section className="space-y-2" aria-live="polite" aria-busy={loading}>
          <h3 className="font-medium text-sm">{t("productHelp.sources")}</h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("productHelp.loading")}</p>
          ) : result?.source !== "live" ? (
            <p className="text-sm text-muted-foreground">
              {t(
                result?.reason === "policy" ? "productHelp.policyFallback" : "productHelp.offline"
              )}
            </p>
          ) : (
            result.articles.map((source, index) => (
              <article key={`${source.url}-${index}`} className="border-s-2 border-border ps-3">
                <Button
                  variant="link"
                  className="p-0 h-auto whitespace-normal text-start"
                  onClick={() => void window.electronAPI.openExternal(source.url)}
                >
                  {source.title}
                </Button>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground line-clamp-5">
                  {markdownToPlainText(
                    source.text
                      .split("\n")
                      .filter((line) => !line.trimStart().startsWith("<"))
                      .join("\n")
                  ).replace(/\s+/g, " ")}
                </p>
              </article>
            ))
          )}
          {!loading && (
            <Button variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>
              {t("productHelp.refresh")}
            </Button>
          )}
        </section>
        <details className="border-t border-border pt-3">
          <summary className="text-sm cursor-pointer">{t("productHelp.settings")}</summary>
          <p className="text-xs text-muted-foreground my-2">{t("productHelp.settingsNote")}</p>
          {context ? (
            <>
              <p className="text-xs text-muted-foreground mb-2">
                OpenWhispr {context.version} ·{" "}
                {{ darwin: "macOS", win32: "Windows", linux: "Linux" }[context.platform] ||
                  context.platform}
              </p>
              <dl className="text-sm grid grid-cols-2 gap-x-3 gap-y-1">
                {Object.entries(context.values).map(([key, value]) => (
                  <div className="contents" key={key}>
                    <dt className="text-muted-foreground">
                      {t(labels[key])}
                      {key.endsWith("Engine")
                        ? ` · ${t("common.model")}`
                        : key.endsWith("Permission")
                          ? ` · ${t("settingsPage.permissions.title")}`
                          : ""}
                    </dt>
                    <dd className="break-words">
                      {value == null
                        ? t("common.unknown")
                        : typeof value === "boolean"
                          ? t(value ? "productHelp.on" : "productHelp.off")
                          : valueLabels[value]
                            ? t(valueLabels[value])
                            : value}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="text-sm">{t("common.unknown")}</p>
          )}
        </details>
      </DialogContent>
    </Dialog>
  );
}
