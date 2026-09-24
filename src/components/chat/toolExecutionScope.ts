import type { ToolExecutionContext } from "../../services/tools/ToolRegistry";

export interface ToolContextRequest {
  /** The assistant message the tool call belongs to. */
  messageId: string;
  toolCallId: string;
  /** The model SDK's own per-call abort signal, when it has one. */
  signal?: AbortSignal;
}

export interface ToolExecutionScope {
  createContext: (request: ToolContextRequest) => ToolExecutionContext;
  abort: () => void;
}

interface ToolExecutionHandlers {
  onApprovalRequested?: () => void;
  onHoldDelivery?: () => void;
}

/**
 * One scope per chat send. Its signal is the single thing every
 * conversation-ending path (Esc, new chat, unmount) aborts, so tools waiting
 * on the user (approval cards) are released no matter how the turn ended.
 * Notices from a tool that finishes after that are dropped, so a late result
 * cannot reopen a panel the user dismissed.
 */
export function createToolExecutionScope(handlers: ToolExecutionHandlers = {}): ToolExecutionScope {
  const controller = new AbortController();
  const notify = (handler?: () => void) => () => {
    if (!controller.signal.aborted) handler?.();
  };
  return {
    createContext: ({ messageId, toolCallId, signal }) => ({
      messageId,
      toolCallId,
      // Either the turn ending or the SDK abandoning this one call releases
      // whatever the tool is waiting on.
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
      onApprovalRequested: notify(handlers.onApprovalRequested),
      onHoldDelivery: notify(handlers.onHoldDelivery),
    }),
    abort: () => controller.abort(),
  };
}
