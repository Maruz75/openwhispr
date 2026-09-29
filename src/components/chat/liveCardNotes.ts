import type { ConnectorPreviewNote } from "../../types/connectors";
import { githubMentions } from "../../utils/githubMentions";

type LiveCardFields = Record<string, string | string[]>;

// GitHub notifies everyone a title or body mentions, and a team mention
// notifies the whole team, so the card says who before Send.
function githubLiveNotes(fields: LiveCardFields): ConnectorPreviewNote[] {
  const text = (name: string): string => {
    const value = fields[name];
    return typeof value === "string" ? value : "";
  };
  // Title and body apart: a title can't open a code block over the body.
  const seen = new Set<string>();
  const mentions = [...githubMentions(text("title")), ...githubMentions(text("body"))].filter(
    (mention) => {
      const key = mention.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }
  );
  return mentions.length > 0
    ? [
        {
          key: "connectors.approval.github.notes.mentions",
          values: { mentions: mentions.join(", ") },
        },
      ]
    : [];
}

/**
 * Notes an issue or comment card recomputes from its current fields as the
 * user edits, by connector. The notes a connector sends with its preview are
 * fixed at prepare; these follow the card.
 */
export const LIVE_CARD_NOTES: Readonly<
  Record<string, (fields: LiveCardFields) => ConnectorPreviewNote[]>
> = { github: githubLiveNotes };

/** The live notes for a card's fields; none for a connector without an entry. */
export function liveCardNotesFor(
  connectorId: string,
  fields: LiveCardFields
): ConnectorPreviewNote[] {
  return Object.hasOwn(LIVE_CARD_NOTES, connectorId) ? LIVE_CARD_NOTES[connectorId](fields) : [];
}
