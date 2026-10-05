import type { FolderItem, MeetingDestinationContext } from "../types/electron";
import { defaultFolderDisplayName } from "./notes/shared";
const key = (name: string) => `meetingNotification.folders.${name}`;
export function meetingFolderLabel(
  context: MeetingDestinationContext,
  folder: FolderItem,
  t: (key: string) => string
): string {
  const space = context.spaces.find((s) => s.id === folder.space_id);
  const location = space?.kind === "private" ? t(key("private")) : (space?.name ?? "");
  return `${location} / ${defaultFolderDisplayName(folder, t)}${space?.kind === "team" ? ` · ${t(key("shared"))}` : ""}`;
}
