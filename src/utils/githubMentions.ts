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
// unmatched backtick is plain text. CommonMark never lets a span cross a
// blank line, so a stray backtick in one paragraph can't swallow mentions in
// a later one; fenced blocks are already blanked by withoutFencedBlocks, so
// they still end a paragraph here.
const CODE_SPAN = /(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g;

function withoutCodeSpans(text: string): string {
  return text
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.replace(CODE_SPAN, " "))
    .join("\n\n");
}

// A GitHub handle: letters, digits, and inner hyphens or underscores (never
// trailing), at most 39 characters, optionally followed by /team. Not
// preceded by a letter, digit, `@`, `/` or backtick, since those make the @
// part of a word, an email address, a path or a code span; anything else —
// whitespace, punctuation, a markdown emphasis marker, an escaping backslash
// — may still open a mention. GitHub renders and notifies through all of
// those, and under-reporting a mention is the mistake to avoid.
const MENTION =
  /(^|[^A-Za-z0-9@\/`])@([A-Za-z0-9](?:[A-Za-z0-9]|[_-](?=[A-Za-z0-9_])){0,38})(\/[A-Za-z0-9][A-Za-z0-9_-]*)?(?![A-Za-z0-9])/g;

/**
 * The people and teams GitHub notifies for this Markdown: `@name` and
 * `@org/team`, outside code spans and fenced code blocks. Each appears once
 * (GitHub handles ignore case), as first written, in first-seen order.
 */
export function githubMentions(text: string): string[] {
  const seen = new Set<string>();
  const mentions: string[] = [];
  // Paragraph, fence and code-span detection all key off "\n".
  const normalized = text.replace(/\r\n/g, "\n");
  const prose = withoutCodeSpans(withoutFencedBlocks(normalized));
  for (const match of prose.matchAll(MENTION)) {
    const mention = `@${match[2]}${match[3] ?? ""}`;
    const key = mention.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push(mention);
  }
  return mentions;
}
