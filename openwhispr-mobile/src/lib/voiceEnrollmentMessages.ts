import {
  VOICE_ENROLLMENT_LOW_SNR,
  VOICE_ENROLLMENT_LOW_SPEECH_RATIO,
  VOICE_ENROLLMENT_MULTIPLE_SPEAKERS,
  VOICE_ENROLLMENT_NO_SPEECH,
  VOICE_ENROLLMENT_SHORT_SPEECH,
  VoiceEnrollmentError,
} from '@/services/diarization/VoiceprintService';

/** What to tell someone whose voice sample failed, in words they can act on. */
export function voiceEnrollmentFailureMessage(error: unknown): string {
  const code = error instanceof VoiceEnrollmentError ? error.code : null;
  switch (code) {
    case VOICE_ENROLLMENT_NO_SPEECH:
    case VOICE_ENROLLMENT_SHORT_SPEECH:
      return "We didn't hear enough. Read the whole script.";
    case VOICE_ENROLLMENT_LOW_SNR:
      return 'Too much background noise. Try somewhere quieter.';
    case VOICE_ENROLLMENT_LOW_SPEECH_RATIO:
      return 'Lots of pauses. Read at your normal pace.';
    case VOICE_ENROLLMENT_MULTIPLE_SPEAKERS:
      return 'We heard more than one voice. Try again on your own.';
    default:
      return 'Something went wrong checking your voice. Try again.';
  }
}
