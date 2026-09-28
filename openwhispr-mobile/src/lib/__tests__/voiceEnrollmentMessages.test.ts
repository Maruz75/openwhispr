import {
  VOICE_ENROLLMENT_DIARIZATION_FAILED,
  VOICE_ENROLLMENT_LOW_SNR,
  VOICE_ENROLLMENT_LOW_SPEECH_RATIO,
  VOICE_ENROLLMENT_MULTIPLE_SPEAKERS,
  VOICE_ENROLLMENT_NO_SPEECH,
  VOICE_ENROLLMENT_SHORT_SPEECH,
  VoiceEnrollmentError,
} from '@/services/diarization/VoiceprintService';
import { voiceEnrollmentFailureMessage } from '../voiceEnrollmentMessages';

const failure = (code: ConstructorParameters<typeof VoiceEnrollmentError>[0]) =>
  voiceEnrollmentFailureMessage(new VoiceEnrollmentError(code, 'raw service text'));

describe('voiceEnrollmentFailureMessage', () => {
  it('asks for the whole script when too little speech was heard', () => {
    expect(failure(VOICE_ENROLLMENT_NO_SPEECH)).toBe(
      "We didn't hear enough. Read the whole script.",
    );
    expect(failure(VOICE_ENROLLMENT_SHORT_SPEECH)).toBe(
      "We didn't hear enough. Read the whole script.",
    );
  });

  it('explains noise, pauses and extra voices', () => {
    expect(failure(VOICE_ENROLLMENT_LOW_SNR)).toBe(
      'Too much background noise. Try somewhere quieter.',
    );
    expect(failure(VOICE_ENROLLMENT_LOW_SPEECH_RATIO)).toBe(
      'Lots of pauses. Read at your normal pace.',
    );
    expect(failure(VOICE_ENROLLMENT_MULTIPLE_SPEAKERS)).toBe(
      'We heard more than one voice. Try again on your own.',
    );
  });

  describe('when the recording was quiet', () => {
    const levelFailure = (
      code: typeof VOICE_ENROLLMENT_LOW_SPEECH_RATIO | typeof VOICE_ENROLLMENT_SHORT_SPEECH,
      peakDb: number,
    ) =>
      voiceEnrollmentFailureMessage(
        new VoiceEnrollmentError(code, 'raw service text', {
          ok: false,
          code,
          reason: 'raw service text',
          speechActivity: {
            durationMs: 16_906,
            analyzedMs: 16_906,
            speechActivityMs: 3_397,
            speechRatio: 0.2,
            peakDb,
            averageDb: -34,
            noiseFloorDb: -37.3,
            thresholdDb: -30,
            noSpeechLikely: false,
            reason: 'speech_activity_detected',
            confidence: 0.65,
          },
        }),
      );
    const quiet = 'We could barely hear you. Speak up or hold your phone closer.';

    it('blames the volume, not pauses or length', () => {
      // Levels logged from a simulator read through a Mac mic at 29% input volume.
      expect(levelFailure(VOICE_ENROLLMENT_LOW_SPEECH_RATIO, -22.6)).toBe(quiet);
      expect(levelFailure(VOICE_ENROLLMENT_SHORT_SPEECH, -22.6)).toBe(quiet);
    });

    it('keeps the pause and length messages when the voice was loud enough', () => {
      expect(levelFailure(VOICE_ENROLLMENT_LOW_SPEECH_RATIO, -9.4)).toBe(
        'Lots of pauses. Read at your normal pace.',
      );
      expect(levelFailure(VOICE_ENROLLMENT_SHORT_SPEECH, -9.4)).toBe(
        "We didn't hear enough. Read the whole script.",
      );
    });
  });

  it('falls back to a general message for anything else', () => {
    const general = 'Something went wrong checking your voice. Try again.';
    expect(failure(VOICE_ENROLLMENT_DIARIZATION_FAILED)).toBe(general);
    expect(voiceEnrollmentFailureMessage(new Error('boom'))).toBe(general);
    expect(voiceEnrollmentFailureMessage(null)).toBe(general);
  });
});
