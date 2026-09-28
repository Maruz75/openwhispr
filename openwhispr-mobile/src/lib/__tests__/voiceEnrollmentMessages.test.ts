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

  it('falls back to a general message for anything else', () => {
    const general = 'Something went wrong checking your voice. Try again.';
    expect(failure(VOICE_ENROLLMENT_DIARIZATION_FAILED)).toBe(general);
    expect(voiceEnrollmentFailureMessage(new Error('boom'))).toBe(general);
    expect(voiceEnrollmentFailureMessage(null)).toBe(general);
  });
});
