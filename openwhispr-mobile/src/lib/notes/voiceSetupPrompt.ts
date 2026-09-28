import type { Segment, Speaker } from '@/data/types';
import { getSpeakerDisplayName } from '@/lib/diarization/transcriptDisplay';
import { ENROLLMENT_MIN_SPEECH_ACTIVITY_MS } from '@/services/diarization/VoiceprintService';

export interface VoiceSetupCandidate {
  speakerId: number;
  name: string;
  speechMs: number;
  sampleLine: string;
}

const isUnnamed = (speaker: Speaker): boolean =>
  !speaker.displayName?.trim() && speaker.profileId == null;

/** The meeting-note banner: only meetings this device diarized can teach it your voice. */
export function shouldOfferVoiceSetup({
  isOnDeviceMeeting,
  transcriptStatus,
  speakers,
  hasOwnerProfile,
  dismissed,
}: {
  isOnDeviceMeeting: boolean;
  transcriptStatus: string;
  speakers: Speaker[];
  hasOwnerProfile: boolean;
  dismissed: boolean;
}): boolean {
  return (
    isOnDeviceMeeting &&
    transcriptStatus === 'done' &&
    !hasOwnerProfile &&
    !dismissed &&
    speakers.some(isUnnamed)
  );
}

/** Speakers who said enough, with a sample still held from this meeting, longest first. */
export function voiceSetupCandidates({
  segments,
  speakers,
  embeddingsByLabel,
}: {
  segments: Segment[];
  speakers: Speaker[];
  embeddingsByLabel: Record<string, number[]> | undefined;
}): VoiceSetupCandidate[] {
  return speakers
    .filter(
      (speaker) => speaker.profileId == null && !!embeddingsByLabel?.[speaker.speakerLabel]?.length,
    )
    .map((speaker, index) => {
      const own = segments.filter((segment) => segment.speakerLabel === speaker.speakerLabel);
      const speechMs = own.reduce(
        (total, segment) => total + Math.max(0, segment.endMs - segment.startMs),
        0,
      );
      const sampleLine = own
        .map((segment) => segment.text.trim())
        .reduce((longest, text) => (text.length > longest.length ? text : longest), '');
      return {
        speakerId: speaker.id,
        name: getSpeakerDisplayName(speaker, index),
        speechMs,
        sampleLine,
      };
    })
    .filter((candidate) => candidate.speechMs >= ENROLLMENT_MIN_SPEECH_ACTIVITY_MS)
    .sort((a, b) => b.speechMs - a.speechMs);
}
