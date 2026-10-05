// ESM: the Anthropic IPC bridge's failure payload, extracted so it is testable
// without Electron. Loaded by ipcHandlers.js through require(esm).
import { providerHttpError } from "./providerHttpErrors.js";
import { ipcErrorFields } from "./ipcErrorFields.js";

export function anthropicFailure({ status, body, headers, model }) {
  const error = providerHttpError({
    provider: "Anthropic",
    model,
    status,
    body,
    headers,
    surface: "llm",
  });
  return { success: false, ...ipcErrorFields(error) };
}
