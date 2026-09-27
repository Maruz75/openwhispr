import { boundChatContext, buildNoteChatContext } from '@/lib/notes/chatOverNote';

describe('buildNoteChatContext', () => {
  it('returns the source text unchanged when there are no generated notes', () => {
    expect(buildNoteChatContext({ generatedNotes: null, sourceText: '  Raw notes  ' })).toBe(
      'Raw notes',
    );
  });

  it('puts the generated notes ahead of the source text', () => {
    const context = buildNoteChatContext({
      generatedNotes: '## Action items\n- Ship it',
      sourceText: 'Meeting transcript:\n[0:00] Speaker 1: Ship it.',
    });

    expect(context).toBe(
      'Generated notes:\n## Action items\n- Ship it\n\n' +
        'Original notes and transcript:\nMeeting transcript:\n[0:00] Speaker 1: Ship it.',
    );
  });

  it('still gives context when only generated notes exist', () => {
    expect(buildNoteChatContext({ generatedNotes: 'Summary', sourceText: '   ' })).toBe(
      'Generated notes:\nSummary',
    );
  });

  it('keeps the generated notes when a long transcript is truncated', () => {
    const context = buildNoteChatContext({
      generatedNotes: 'Decision: launch Friday',
      sourceText: 'x'.repeat(40_000),
    });

    expect(boundChatContext(context).text).toContain('Decision: launch Friday');
  });
});
