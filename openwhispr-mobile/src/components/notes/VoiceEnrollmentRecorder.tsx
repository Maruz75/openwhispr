import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import * as FileSystem from 'expo-file-system/legacy';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { SystemIcon } from '@/components/ui/SystemIcon';
import { WaveformVisualizer } from '@/components/features/WaveformVisualizer';
import { useAudioRecording } from '@/hooks/useAudioRecording';
import { useAudioWaveform } from '@/hooks/useAudioWaveform';
import { BRAND } from '@/config/colors';
import { SpeakerProfileOwnerAlreadyExistsError } from '@/data/local/notesRepository';
import {
  VOICE_ENROLLMENT_DIARIZER_MODEL_REQUIRED,
  VoiceEnrollmentError,
  type EnrollVoiceProfileInput,
  type ReenrollVoiceProfileInput,
} from '@/services/diarization/VoiceprintService';
import { voiceEnrollmentFailureMessage } from '@/lib/voiceEnrollmentMessages';

export type VoiceEnrollmentMode = 'self' | 'retrain' | 'other';

type Phase =
  | 'checking-model'
  | 'needs-model'
  | 'ready'
  | 'recording'
  | 'checking'
  | 'download-failed'
  | 'failed'
  | 'done';

interface VoiceEnrollmentRecorderProps {
  mode: VoiceEnrollmentMode;
  isOwner: boolean;
  defaultDisplayName?: string;
  profileId?: number;
  isModelReady: () => Promise<boolean>;
  downloadModel: () => Promise<void>;
  onSubmit: (input: EnrollVoiceProfileInput | ReenrollVoiceProfileInput) => Promise<void>;
  onDone: () => void;
  onCancel: () => void;
  now?: () => Date;
}

// Reading the script aloud is the consent, so it names what the profile is for.
export const VOICE_ENROLLMENT_SCRIPT =
  "I'm teaching OpenWhispr my voice so it can label me in my meeting notes. This voice profile stays on my device, is only used to recognize me in recordings I choose to process, and I can delete it at any time.";

const MIC_START_FAILURE =
  "Couldn't start the microphone. Check that OpenWhispr can use it in Settings, then try again.";

const MIN_SECONDS = 10;
const MAX_SECONDS = 30;
const RING_SECONDS = 20;
const RING_SIZE = 88;
const RING_STROKE = 4;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const deleteRecording = (uri: string): void => {
  FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
};

export function VoiceEnrollmentRecorder({
  mode,
  isOwner,
  defaultDisplayName,
  profileId,
  isModelReady,
  downloadModel,
  onSubmit,
  onDone,
  onCancel,
  now = () => new Date(),
}: VoiceEnrollmentRecorderProps): React.JSX.Element {
  const recording = useAudioRecording();
  const { currentAmplitude, waveformData } = useAudioWaveform(
    recording.audioRecorder,
    recording.isRecording,
  );
  const [phase, setPhase] = useState<Phase>('checking-model');
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'failed'>('idle');
  const [displayName, setDisplayName] = useState(defaultDisplayName ?? (isOwner ? 'Me' : ''));
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const consentAtRef = useRef<string | null>(null);
  const downloadRef = useRef<Promise<void> | null>(null);
  // A finished recording not yet handed to onSubmit; deleted if you leave.
  const pendingUriRef = useRef<string | null>(null);
  const stoppingRef = useRef(false);
  const mountedRef = useRef(true);
  const cancelRecordingRef = useRef(recording.cancelRecording);
  cancelRecordingRef.current = recording.cancelRecording;
  const audioRecorderRef = useRef(recording.audioRecorder);
  audioRecorderRef.current = recording.audioRecorder;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Stops the recorder, then deletes the partial sample it was writing.
  const discardActiveRecording = useCallback((): void => {
    Promise.resolve(cancelRecordingRef.current())
      .then(() => {
        const uri = audioRecorderRef.current?.uri;
        if (uri) deleteRecording(uri);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    isModelReady().then(
      (ready) => active && setPhase(ready ? 'ready' : 'needs-model'),
      () => active && setPhase('needs-model'),
    );
    return () => {
      active = false;
    };
  }, [isModelReady]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (pendingUriRef.current) deleteRecording(pendingUriRef.current);
      pendingUriRef.current = null;
      // A stop already in flight deletes its own file once it resolves (see submit).
      if (phaseRef.current === 'recording' && !stoppingRef.current) {
        discardActiveRecording();
      } else {
        Promise.resolve(cancelRecordingRef.current()).catch(() => undefined);
      }
    },
    [discardActiveRecording],
  );

  useEffect(() => {
    if (phase !== 'recording') {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const startDownload = useCallback((): void => {
    setDownloadStatus('downloading');
    const download = downloadModel();
    downloadRef.current = download;
    download.then(
      () => {
        if (downloadRef.current === download) downloadRef.current = null;
        if (mountedRef.current) setDownloadStatus('idle');
      },
      () => {
        if (mountedRef.current) setDownloadStatus('failed');
      },
    );
  }, [downloadModel]);

  const trimmedName = displayName.trim();

  const discardPending = (uri: string): void => {
    pendingUriRef.current = null;
    deleteRecording(uri);
  };

  const submit = useCallback(
    async (uri: string): Promise<void> => {
      setPhase('checking');
      // Held here while the model downloads so leaving deletes it.
      pendingUriRef.current = uri;
      try {
        await downloadRef.current;
      } catch {
        // Kept so a retried download can check it without reading again.
        if (mountedRef.current) setPhase('download-failed');
        else discardPending(uri);
        return;
      }
      // Left while stopping or waiting: nothing will check this recording.
      if (!mountedRef.current) {
        discardPending(uri);
        return;
      }
      // From here the enrollment service owns the file until the finally below.
      pendingUriRef.current = null;
      const input = {
        recordings: [{ uri, mimeType: 'audio/wav' }],
        displayName: trimmedName || 'Me',
        isOwner,
        consentAccepted: true as const,
        consentAcceptedAt: consentAtRef.current ?? now().toISOString(),
      };
      try {
        await onSubmit(profileId === undefined ? input : { ...input, profileId });
        setPhase('done');
      } catch (caught) {
        if (caught instanceof SpeakerProfileOwnerAlreadyExistsError) {
          // The screen explains this one.
          setPhase('ready');
          return;
        }
        if (
          caught instanceof VoiceEnrollmentError &&
          caught.code === VOICE_ENROLLMENT_DIARIZER_MODEL_REQUIRED
        ) {
          setPhase('needs-model');
          return;
        }
        setFailure(voiceEnrollmentFailureMessage(caught));
        setPhase('failed');
      } finally {
        deleteRecording(uri);
      }
    },
    [isOwner, now, onSubmit, profileId, trimmedName],
  );

  const stop = useCallback(async (): Promise<void> => {
    // Done and the 30 s auto-stop can land together; only the first one stops.
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      const uri = await recording.stopRecordingRaw();
      if (!uri) {
        setFailure(voiceEnrollmentFailureMessage(null));
        setPhase('failed');
        return;
      }
      await submit(uri);
    } catch (caught) {
      if (!mountedRef.current) {
        discardActiveRecording();
        return;
      }
      setFailure(voiceEnrollmentFailureMessage(caught));
      setPhase('failed');
    } finally {
      stoppingRef.current = false;
    }
  }, [discardActiveRecording, recording, submit]);

  useEffect(() => {
    if (phase === 'recording' && elapsedSeconds >= MAX_SECONDS) stop().catch(() => undefined);
  }, [elapsedSeconds, phase, stop]);

  const start = useCallback(async (): Promise<void> => {
    setFailure(null);
    consentAtRef.current ??= now().toISOString();
    try {
      await recording.startRecording();
      // Left before the microphone opened: stop it and drop what it started writing.
      if (!mountedRef.current) {
        discardActiveRecording();
        return;
      }
      setPhase('recording');
    } catch {
      setFailure(MIC_START_FAILURE);
      setPhase('failed');
    }
  }, [discardActiveRecording, now, recording]);

  const retryDownload = useCallback(async (): Promise<void> => {
    startDownload();
    const uri = pendingUriRef.current;
    if (uri) await submit(uri);
  }, [startDownload, submit]);

  if (phase === 'checking-model') {
    return <ActivityIndicator className="mt-10" />;
  }

  if (phase === 'needs-model') {
    return (
      <View className="gap-4">
        <Text accessibilityRole="header" className="text-[20px] font-semibold text-label">
          Download the speaker model
        </Text>
        <Text className="text-[15px] leading-5 text-secondaryLabel">
          OpenWhispr needs a one-time download of about 100 MB to recognise voices. It runs entirely
          on your device after that.
        </Text>
        <Button
          testID="voice-enrollment-download"
          onPress={() => {
            startDownload();
            setPhase('ready');
          }}
        >
          Download
        </Button>
        <Button testID="voice-enrollment-not-now" variant="secondary" onPress={onCancel}>
          Not Now
        </Button>
      </View>
    );
  }

  if (phase === 'done') {
    const labelled = isOwner ? 'you as Me' : trimmedName;
    return (
      <View className="items-center gap-3 pt-6">
        <SystemIcon
          name="checkmark.circle.fill"
          mdName="CircleCheck"
          size={44}
          color="systemGreen"
        />
        <Text className="text-[22px] font-semibold text-label">All set</Text>
        <Text className="text-center text-[15px] leading-5 text-secondaryLabel">
          {`Future on-device meetings will label ${labelled}.`}
        </Text>
        <Button testID="voice-enrollment-done" className="mt-2 self-stretch" onPress={onDone}>
          Done
        </Button>
      </View>
    );
  }

  const needsName = mode === 'other' && !trimmedName;
  const ringProgress = Math.min(elapsedSeconds / RING_SECONDS, 1);

  return (
    <View className="gap-5">
      {mode === 'other' ? (
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Their name"
          placeholderTextColor="rgba(60,60,67,0.3)"
          editable={phase === 'ready' || phase === 'failed'}
          testID="voice-enrollment-name"
          className="rounded-xl border border-separator bg-secondarySystemGroupedBackground px-4 py-3 text-[17px] text-label"
          style={{ borderCurve: 'continuous' }}
        />
      ) : null}

      <Text className="text-[15px] leading-5 text-secondaryLabel">
        Read this aloud in your normal voice. It takes about 20 seconds.
      </Text>
      <View
        className="rounded-xl border border-separator bg-secondarySystemGroupedBackground p-4"
        style={{ borderCurve: 'continuous' }}
      >
        <Text className="text-[19px] leading-7 text-label">{VOICE_ENROLLMENT_SCRIPT}</Text>
      </View>

      {downloadStatus === 'downloading' ? (
        <View className="flex-row items-center gap-2" testID="voice-enrollment-downloading">
          <ActivityIndicator size="small" />
          <Text className="text-[13px] text-secondaryLabel">Downloading speaker model…</Text>
        </View>
      ) : null}
      {downloadStatus === 'failed' && phase !== 'download-failed' ? (
        <View className="flex-row items-center justify-between">
          <Text className="text-[13px] text-systemRed">
            The speaker model didn&apos;t download.
          </Text>
          <Pressable
            onPress={startDownload}
            accessibilityRole="button"
            testID="voice-enrollment-download-retry"
            className="min-h-11 justify-center px-2"
          >
            <Text className="text-[14px] font-medium text-brand">Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'failed' && failure ? (
        <View
          className="gap-2 rounded-xl border border-systemRed/30 bg-systemRed/10 p-3"
          testID="voice-enrollment-error"
        >
          <Text className="text-[14px] leading-5 text-systemRed">{failure}</Text>
        </View>
      ) : null}

      {phase === 'checking' ? (
        <View className="items-center gap-2 py-6" testID="voice-enrollment-checking">
          <ActivityIndicator />
          <Text className="text-[15px] text-secondaryLabel">Checking your voice…</Text>
        </View>
      ) : phase === 'download-failed' ? (
        <View className="gap-3 py-2">
          <Text className="text-[15px] leading-5 text-secondaryLabel">
            The speaker model didn&apos;t download, so your recording couldn&apos;t be checked yet.
          </Text>
          <Button
            testID="voice-enrollment-download-retry"
            onPress={() => {
              retryDownload().catch(() => undefined);
            }}
          >
            Retry
          </Button>
        </View>
      ) : phase === 'failed' ? (
        <Button
          testID="voice-enrollment-try-again"
          onPress={() => {
            setFailure(null);
            setPhase('ready');
          }}
        >
          Try Again
        </Button>
      ) : (
        <View className="items-center gap-4">
          {phase === 'recording' ? (
            <WaveformVisualizer
              isRecording
              height={80}
              color={BRAND}
              amplitude={currentAmplitude}
              waveformData={waveformData}
            />
          ) : null}
          <Pressable
            onPress={phase === 'ready' ? () => start().catch(() => undefined) : undefined}
            disabled={phase !== 'ready' || needsName}
            accessibilityRole="button"
            accessibilityLabel={phase === 'recording' ? 'Recording' : 'Start recording'}
            accessibilityState={{ disabled: phase !== 'ready' || needsName }}
            testID="voice-enrollment-record"
            style={{ width: RING_SIZE, height: RING_SIZE, opacity: needsName ? 0.4 : 1 }}
            className="items-center justify-center"
          >
            <Svg width={RING_SIZE} height={RING_SIZE} style={{ position: 'absolute' }}>
              <Circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                stroke={BRAND}
                strokeOpacity={0.15}
                strokeWidth={RING_STROKE}
                fill="none"
              />
              <Circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                stroke={BRAND}
                strokeWidth={RING_STROKE}
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - ringProgress)}
                strokeLinecap="round"
                fill="none"
                transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
              />
            </Svg>
            <View className="h-16 w-16 items-center justify-center rounded-full bg-brand">
              <SystemIcon name="mic.fill" mdName="Mic" size={26} color="#FFFFFF" />
            </View>
          </Pressable>
          {phase === 'recording' ? (
            <Button
              testID="voice-enrollment-stop"
              className="self-stretch"
              disabled={elapsedSeconds < MIN_SECONDS}
              accessibilityState={{ disabled: elapsedSeconds < MIN_SECONDS }}
              onPress={() => {
                stop().catch(() => undefined);
              }}
            >
              Done
            </Button>
          ) : (
            <Text className="text-[13px] text-tertiaryLabel">Tap to start reading</Text>
          )}
        </View>
      )}
    </View>
  );
}
