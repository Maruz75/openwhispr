import type { ToolExecutionContext, ToolResult } from "../ToolRegistry";
import { requestApproval } from "../../../stores/connectorApprovalStore";
import { approvalOutcomeResult, prepareFailureResult, unavailableResult } from "./toolOutcome";

/**
 * Prepare in main, show the card, and report what the user decided.
 * `unknownGuidance` tells the model where the user can check a send that
 * may or may not have gone out (Gmail: the Sent folder).
 */
export async function runApprovalAction(
  context: ToolExecutionContext | undefined,
  connectorId: string,
  action: string,
  args: Record<string, unknown>,
  options: { unknownGuidance?: string } = {}
): Promise<ToolResult> {
  if (!context) return unavailableResult("no_chat_context");
  const prepared = await window.electronAPI?.connectorPrepare?.(connectorId, action, args);
  if (!prepared) return unavailableResult("connectors_unavailable");
  if (prepared.status !== "ready") return prepareFailureResult(prepared, connectorId);

  const outcome = await requestApproval(context, {
    actionId: prepared.actionId,
    connectorId,
    preview: prepared.preview,
  });
  return approvalOutcomeResult(outcome, prepared.preview.destinationLabel, {
    ...options,
    connectorId,
  });
}
