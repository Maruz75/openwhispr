import topics from "./topics.json";
import { getSettings, selectResolvedLLMConfig } from "../../stores/settingsStore";
import { usePolicyStore } from "../../stores/policyStore";
import { projectHelpSettings } from "./helpContext";
import { isAgentAllowed } from "../../stores/policyRules";

export type HelpTopic = keyof typeof topics;
export const HELP_TOPICS = Object.keys(topics) as HelpTopic[];
export interface HelpArticle {
  title: string;
  url: string;
  path: string;
  text: string;
}
export interface HelpResult {
  source: "live" | "bundled";
  reason: "policy" | "rateLimit" | "unavailable" | null;
  retrievedAt: string | null;
  articles: HelpArticle[];
}
export interface HelpBasics {
  platform: string;
  version: string;
  microphonePermission: string;
  accessibilityPermission: string;
  systemAudioPermission?: string;
}

export async function lookupHelp(
  topic: HelpTopic,
  signal: AbortSignal,
  page?: string
): Promise<HelpResult> {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const id = crypto.randomUUID();
  const cancel = () => window.electronAPI.cancelProductHelp(id);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const result = await window.electronAPI.productHelp(id, { topic, ...(page ? { page } : {}) });
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return result;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

/** Explicit projection, never spread settings: provider URLs, keys, notes and paths stay private. */
export async function getHelpContext(topic: HelpTopic) {
  const basics = await window.electronAPI.productHelpBasics();
  const state = getSettings();
  const policy = usePolicyStore.getState();
  const values = projectHelpSettings(
    topic,
    state as unknown as Record<string, unknown>,
    basics,
    selectResolvedLLMConfig(state, "chatIntelligence"),
    isAgentAllowed(policy)
  );
  if (topic === "assistant" || topic === "models") {
    values.voiceAssistantMode = selectResolvedLLMConfig(state, "dictationAgent").mode;
    values.cleanupMode = selectResolvedLLMConfig(state, "dictationCleanup").mode;
  }
  return {
    platform: basics.platform,
    version: basics.version,
    readAt: new Date().toISOString(),
    policyStatus: policy.status,
    values,
    note: "Read-only saved configuration and known permission state, not a device test. Missing values are unknown. Processing selections may be constrained by organisation policy.",
  };
}
