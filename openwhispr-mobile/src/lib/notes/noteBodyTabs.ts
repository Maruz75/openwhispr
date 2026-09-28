export type NoteBodyView = 'enhanced' | 'transcript' | 'notes';

export interface NoteBodyTabInput {
  usesSegmentTranscript: boolean;
  hasEnhanced: boolean;
}

export const NOTE_BODY_TAB_LABELS: Record<NoteBodyView, string> = {
  enhanced: 'Enhanced',
  transcript: 'Transcript',
  notes: 'My notes',
};

/** Once notes are generated the transcript moves to ⋯ → View Transcript. */
export function getNoteBodyTabs({
  usesSegmentTranscript,
  hasEnhanced,
}: NoteBodyTabInput): NoteBodyView[] {
  if (hasEnhanced) return ['enhanced', 'notes'];
  if (usesSegmentTranscript) return ['transcript', 'notes'];
  return ['notes'];
}

/**
 * The view to show for the user's last pick. My notes always exists, so typing is never
 * interrupted; a pick whose tab disappeared (Transcript once notes are generated) lands on the
 * first tab.
 */
export function resolveNoteBodyView(
  requested: NoteBodyView,
  input: NoteBodyTabInput,
): NoteBodyView {
  const tabs = getNoteBodyTabs(input);
  return tabs.includes(requested) ? requested : tabs[0];
}

/**
 * The pick a note opens with. Audio notes ask for the transcript even before their segments
 * exist, so the view follows the transcript and then the generated notes as they arrive.
 */
export function defaultNoteBodyView({
  isAudioTranscript,
  hasEnhanced,
}: {
  isAudioTranscript: boolean;
  hasEnhanced: boolean;
}): NoteBodyView {
  if (hasEnhanced) return 'enhanced';
  return isAudioTranscript ? 'transcript' : 'notes';
}
