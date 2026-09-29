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

// A code span is a whole run of backticks closed by a run of the same
// length; part of a longer run never opens one. An unmatched backtick is
// plain text.
const CODE_SPAN = /(?<!`)(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g;

// CommonMark never lets a code span leave its block, so a stray backtick in
// one list item, heading, quote line or table row can't swallow mentions in
// the next. A block ends at a blank line (fenced blocks are blank by now),
// after a heading, and before a line that opens a new block. A quote's
// lines are split apart too, which can only show more mentions, never fewer.
const BLOCK_START = /^ {0,3}(?:[-+*][ \t]|\d{1,9}[.)][ \t]|#{1,6}(?:[ \t]|$)|>|\|)/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;

function withoutCodeSpans(text: string): string {
  const blocks: string[] = [];
  let block: string[] = [];
  const endBlock = (): void => {
    if (block.length > 0) blocks.push(block.join("\n").replace(CODE_SPAN, " "));
    block = [];
  };
  let afterHeading = false;
  for (const line of text.split("\n")) {
    if (afterHeading || !line.trim() || BLOCK_START.test(line)) endBlock();
    afterHeading = HEADING.test(line);
    if (line.trim()) block.push(line);
  }
  endBlock();
  return blocks.join("\n");
}

// A GitHub handle: letters, digits, and inner hyphens or underscores (never
// trailing), at most 39 characters, optionally followed by /team. Not
// preceded by a letter, digit, `@` or `/`, since those make the @ part of a
// word, an email address or a path; anything else — whitespace,
// punctuation, a markdown emphasis marker, an escaping backslash, a
// backtick that opened no code span — may still open a mention. GitHub
// renders and notifies through all of those, and under-reporting a mention
// is the mistake to avoid.
const MENTION =
  /(^|[^A-Za-z0-9@\/])@([A-Za-z0-9](?:[A-Za-z0-9]|[_-](?=[A-Za-z0-9_])){0,38})(\/[A-Za-z0-9][A-Za-z0-9_-]*)?(?![A-Za-z0-9])/g;

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

/**
 * Who an issue or comment notifies: the mentions in its title and body, read
 * apart (a title can't open a code block over the body), each once.
 */
export function githubFieldMentions(fields: { title?: unknown; body?: unknown }): string[] {
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  const seen = new Set<string>();
  return [...githubMentions(text(fields.title)), ...githubMentions(text(fields.body))].filter(
    (mention) => {
      const key = mention.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }
  );
}
