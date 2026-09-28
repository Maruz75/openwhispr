import {
  VOICE_ENROLLMENT_LOW_SNR,
  VOICE_ENROLLMENT_LOW_SPEECH_RATIO,
  VOICE_ENROLLMENT_MULTIPLE_SPEAKERS,
  VOICE_ENROLLMENT_NO_SPEECH,
  VOICE_ENROLLMENT_SHORT_SPEECH,
  VoiceEnrollmentError,
} from '@/services/diarization/VoiceprintService';

// The speech detector never sets its bar above -30 dB, so a voice whose loudest moment
// stays below this reads as pauses or too little speech. Measured: failed reads peaked
// at -22 to -24 dB, a normal read at -9 dB.
const QUIET_PEAK_DB = -18;

const wasTooQuiet = (error: VoiceEnrollmentError): boolean => {
  const quality = error.quality;
  const peakDb = quality && !quality.ok ? quality.speechActivity?.peakDb : undefined;
  return peakDb !== undefined && peakDb < QUIET_PEAK_DB;
};

/** What to tell someone whose voice sample failed, in words they can act on. */
export function voiceEnrollmentFailureMessage(error: unknown): string {
  if (!(error instanceof VoiceEnrollmentError)) {
    return 'Something went wrong checking your voice. Try again.';
  }
  const { code } = error;
  if (
    (code === VOICE_ENROLLMENT_LOW_SPEECH_RATIO || code === VOICE_ENROLLMENT_SHORT_SPEECH) &&
    wasTooQuiet(error)
  ) {
    return 'We could barely hear you. Speak up or hold your phone closer.';
  }
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
