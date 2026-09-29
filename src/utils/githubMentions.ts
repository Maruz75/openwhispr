// A fence opens a code block on a line of its own: up to three spaces, then
// three or more backticks or tildes.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// Fenced code blocks become blank lines. An unclosed fence runs to the end
// of the text, as GitHub renders it.
function withoutFencedBlocks(text: string): string {
  let open: string | null = null;
  return text
    .split("\n")
    .map((line) => {
      const fence = FENCE.exec(line)?.[1] ?? null;
      if (open) {
        // Closed by the same character, at least as long, and nothing after it.
        if (
          fence &&
          fence[0] === open[0] &&
          fence.length >= open.length &&
          !line.trim().slice(fence.length).trim()
        ) {
          open = null;
        }
        return "";
      }
      if (fence) open = fence;
      return fence ? "" : line;
    })
    .join("\n");
}

// A code span is a run of backticks closed by a run of the same length. An
// unmatched backtick is plain text.
function withoutCodeSpans(text: string): string {
  return text.replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, " ");
}

// A GitHub handle: letters, digits and single inner hyphens, at most 39
// characters, optionally followed by /team. Not preceded by anything that
// makes the @ part of a word, an email address, a path or an escape.
const MENTION =
  /(^|[^A-Za-z0-9_@\\/.`-])@([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})(\/[A-Za-z0-9][A-Za-z0-9_-]*)?(?![A-Za-z0-9_])/g;

/**
 * The people and teams GitHub notifies for this Markdown: `@name` and
 * `@org/team`, outside code spans and fenced code blocks. Each appears once
 * (GitHub handles ignore case), as first written, in first-seen order.
 */
export function githubMentions(text: string): string[] {
  const seen = new Set<string>();
  const mentions: string[] = [];
  const prose = withoutCodeSpans(withoutFencedBlocks(text));
  for (const match of prose.matchAll(MENTION)) {
    const mention = `@${match[2]}${match[3] ?? ""}`;
    const key = mention.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push(mention);
  }
  return mentions;
}
