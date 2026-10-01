import { useEffect, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "./icons";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useSettingsStore } from "../stores/settingsStore";
import { ensureConnectorStatus, useConnectorStatusStore } from "../stores/connectorStatusStore";
import ApiKeysSection from "./ApiKeysSection";
import { ConnectorsSection } from "./ConnectorsSection";
import { CONNECTOR_ROWS } from "./connectors/connectorRows";
import { IntegrationsNav } from "./integrations/IntegrationsNav";
import { IntegrationsPane, UpsellBar } from "./integrations/IntegrationsPane";
import { CalendarsPane } from "./integrations/CalendarsPane";
import { McpPane } from "./integrations/McpPane";
import { CliPane } from "./integrations/CliPane";
import {
  INTEGRATIONS_SECTION_ICONS,
  INTEGRATIONS_SECTIONS,
  sectionMeta,
  type IntegrationsSection,
  type SectionMeta,
} from "./integrations/integrationsSections";

const API_DOCS_URL = "https://docs.openwhispr.com/api/overview";
const { mcp: McpIcon, cli: CliIcon } = INTEGRATIONS_SECTION_ICONS;

interface IntegrationsViewProps {
  isPaid: boolean;
  onUpgrade: () => void;
  section: IntegrationsSection;
  onSectionChange: (section: IntegrationsSection) => void;
}

export default function IntegrationsView({
  isPaid,
  onUpgrade,
  section,
  onSectionChange,
}: IntegrationsViewProps): ReactElement {
  const { t } = useTranslation();
  const isMac = window.electronAPI?.getPlatform?.() === "darwin";
  const connectedConnectors = useConnectorStatusStore(
    (state) => CONNECTOR_ROWS.filter((row) => state.statuses[row.id]?.connected).length
  );
  const connectedCalendars = useSettingsStore(
    (state) =>
      [
        state.gcalAccounts.length > 0,
        state.mcalAccounts.length > 0,
        isMac && state.appleCalendarConnected,
      ].filter(Boolean).length
  );

  // The nav counts connected logins on every section, not only once Connectors has mounted.
  useEffect(() => {
    void ensureConnectorStatus();
  }, []);

  const meta = Object.fromEntries(
    INTEGRATIONS_SECTIONS.map((id) => [
      id,
      sectionMeta(id, { isPaid, connectedConnectors, connectedCalendars }),
    ])
  ) as Record<IntegrationsSection, SectionMeta | null>;
  const title = t(`integrations.nav.sections.${section}`);

  return (
    <div className="@container flex h-full min-h-0">
      <IntegrationsNav
        active={section}
        meta={meta}
        onSelect={onSectionChange}
        className="@max-2xl:hidden"
      />

      <div key={section} className="flex-1 min-w-0 overflow-y-auto px-8 pt-2 pb-6 @max-2xl:px-5">
        <div className="max-w-[760px] space-y-4">
          <Select
            value={section}
            onValueChange={(value) => onSectionChange(value as IntegrationsSection)}
          >
            <SelectTrigger
              className="h-8 w-full text-xs rounded-lg @2xl:hidden"
              aria-label={t("integrations.nav.label")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTEGRATIONS_SECTIONS.map((id) => (
                <SelectItem key={id} value={id}>
                  {t(`integrations.nav.sections.${id}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {section === "connectors" && (
            <IntegrationsPane title={title} description={t("integrations.connectors.description")}>
              <ConnectorsSection onUpgrade={onUpgrade} />
            </IntegrationsPane>
          )}

          {section === "calendars" && <CalendarsPane title={title} />}

          {section === "api" && (
            <IntegrationsPane
              title={title}
              description={t("integrations.api.description")}
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.electronAPI?.openExternal?.(API_DOCS_URL)}
                  className="gap-1.5 text-muted-foreground"
                >
                  {t("apiKeysSection.docsLink")}
                  <ExternalLink className="h-3 w-3" />
                </Button>
              }
            >
              {isPaid ? (
                <>
                  <ApiKeysSection />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 ps-1 text-xs text-muted-foreground">
                    <span>{t("integrations.api.useWith")}</span>
                    <button
                      type="button"
                      onClick={() => onSectionChange("mcp")}
                      className="inline-flex items-center gap-1 rounded-sm text-primary/80 hover:text-primary outline-none focus-visible:ring-1 focus-visible:ring-primary/30 transition-colors"
                    >
                      <McpIcon size={13} />
                      {t("integrations.nav.sections.mcp")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSectionChange("cli")}
                      className="inline-flex items-center gap-1 rounded-sm text-primary/80 hover:text-primary outline-none focus-visible:ring-1 focus-visible:ring-primary/30 transition-colors"
                    >
                      <CliIcon size={13} />
                      {t("integrations.nav.sections.cli")}
                    </button>
                  </div>
                </>
              ) : (
                <UpsellBar message={t("integrations.api.proRequired")} onUpgrade={onUpgrade} />
              )}
            </IntegrationsPane>
          )}

          {section === "mcp" && (
            <McpPane
              title={title}
              isPaid={isPaid}
              onUpgrade={onUpgrade}
              onCreateKey={() => onSectionChange("api")}
            />
          )}

          {section === "cli" && <CliPane title={title} isPaid={isPaid} onUpgrade={onUpgrade} />}
        </div>
      </div>
    </div>
  );
}
