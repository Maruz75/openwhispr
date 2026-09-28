import {
  defaultNoteBodyView,
  getNoteBodyTabs,
  NOTE_BODY_TAB_LABELS,
  resolveNoteBodyView,
} from '@/lib/notes/noteBodyTabs';

describe('getNoteBodyTabs', () => {
  it('offers Transcript and My notes on a transcript note before notes are generated', () => {
    expect(getNoteBodyTabs({ usesSegmentTranscript: true, hasEnhanced: false })).toEqual([
      'transcript',
      'notes',
    ]);
  });

  it('offers Enhanced and My notes once notes are generated, on any note', () => {
    expect(getNoteBodyTabs({ usesSegmentTranscript: true, hasEnhanced: true })).toEqual([
      'enhanced',
      'notes',
    ]);
    expect(getNoteBodyTabs({ usesSegmentTranscript: false, hasEnhanced: true })).toEqual([
      'enhanced',
      'notes',
    ]);
  });

  it('offers only My notes on a plain note without generated notes', () => {
    expect(getNoteBodyTabs({ usesSegmentTranscript: false, hasEnhanced: false })).toEqual([
      'notes',
    ]);
  });

  it('labels the tabs', () => {
    expect(NOTE_BODY_TAB_LABELS).toEqual({
      enhanced: 'Enhanced',
      transcript: 'Transcript',
      notes: 'My notes',
    });
  });
});

describe('resolveNoteBodyView', () => {
  const meeting = { usesSegmentTranscript: true, hasEnhanced: false };
  const generated = { usesSegmentTranscript: true, hasEnhanced: true };

  it('keeps the requested view while its tab exists', () => {
    expect(resolveNoteBodyView('transcript', meeting)).toBe('transcript');
    expect(resolveNoteBodyView('notes', generated)).toBe('notes');
  });

  it('moves from Transcript to Enhanced when generated notes arrive', () => {
    expect(resolveNoteBodyView('transcript', generated)).toBe('enhanced');
  });

  it('falls back to the first tab when the requested one is gone', () => {
    expect(resolveNoteBodyView('enhanced', meeting)).toBe('transcript');
    expect(
      resolveNoteBodyView('enhanced', { usesSegmentTranscript: false, hasEnhanced: false }),
    ).toBe('notes');
  });
});

describe('defaultNoteBodyView', () => {
  it('opens generated notes when they exist', () => {
    expect(defaultNoteBodyView({ isAudioTranscript: true, hasEnhanced: true })).toBe('enhanced');
    expect(defaultNoteBodyView({ isAudioTranscript: false, hasEnhanced: true })).toBe('enhanced');
  });

  it('opens the transcript on an audio note, even before its segments exist', () => {
    expect(defaultNoteBodyView({ isAudioTranscript: true, hasEnhanced: false })).toBe('transcript');
  });

  it('opens My notes on a plain note', () => {
    expect(defaultNoteBodyView({ isAudioTranscript: false, hasEnhanced: false })).toBe('notes');
  });
});
