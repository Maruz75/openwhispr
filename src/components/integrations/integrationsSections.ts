import type { ComponentType } from "react";
import { Calendar, Key, Link2, Network, Terminal } from "../icons";

export type IntegrationsSection = "connectors" | "calendars" | "api" | "mcp" | "cli";

export const DEFAULT_INTEGRATIONS_SECTION: IntegrationsSection = "calendars";

export const INTEGRATIONS_SECTION_GROUPS: ReadonlyArray<{
  id: "assistant" | "meetings" | "developer";
  sections: readonly IntegrationsSection[];
}> = [
  { id: "meetings", sections: ["calendars"] },
  { id: "assistant", sections: ["connectors"] },
  { id: "developer", sections: ["api", "mcp", "cli"] },
];

export const INTEGRATIONS_SECTION_ICONS: Record<
  IntegrationsSection,
  ComponentType<{ size?: number; className?: string }>
> = {
  connectors: Link2,
  calendars: Calendar,
  api: Key,
  mcp: Network,
  cli: Terminal,
};

export type SectionMeta =
  { kind: "count"; value: number } | { kind: "badge"; badge: "pro" | "free" };

export interface SectionMetaInput {
  isPaid: boolean;
  connectedConnectors: number;
  connectedCalendars: number;
}

/** The status shown beside a section in the nav: what's connected, or which plan it needs. */
export function sectionMeta(
  section: IntegrationsSection,
  { isPaid, connectedConnectors, connectedCalendars }: SectionMetaInput
): SectionMeta | null {
  switch (section) {
    case "connectors":
      if (!isPaid) return { kind: "badge", badge: "pro" };
      return connectedConnectors > 0 ? { kind: "count", value: connectedConnectors } : null;
    case "calendars":
      return connectedCalendars > 0 ? { kind: "count", value: connectedCalendars } : null;
    case "api":
    case "mcp":
      return isPaid ? null : { kind: "badge", badge: "pro" };
    case "cli":
      // Local mode is free; saying so is the point of surfacing it to free plans.
      return isPaid ? null : { kind: "badge", badge: "free" };
  }
}

export const INTEGRATIONS_SECTIONS: readonly IntegrationsSection[] =
  INTEGRATIONS_SECTION_GROUPS.flatMap((group) => group.sections);
