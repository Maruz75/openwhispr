import { useCallback, useEffect, useMemo } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import {
  VoiceEnrollmentRecorder,
  type VoiceEnrollmentMode,
} from '@/components/notes/VoiceEnrollmentRecorder';
import { useNotesStore } from '@/store/useNotesStore';
import { SpeakerProfileOwnerAlreadyExistsError } from '@/data/local/notesRepository';
import type {
  EnrollVoiceProfileInput,
  ReenrollVoiceProfileInput,
} from '@/services/diarization/VoiceprintService';

type SubmitInput = EnrollVoiceProfileInput | ReenrollVoiceProfileInput;

export default function VoiceEnrollmentScreen() {
  const params = useLocalSearchParams<{ owner?: string; profileId?: string }>();
  const router = useRouter();
  const profileId = params.profileId ? Number(params.profileId) : null;
  const profiles = useNotesStore((state) => state.voiceProfiles);
  const loadVoiceProfiles = useNotesStore((state) => state.loadVoiceProfiles);
  const enrollVoiceProfile = useNotesStore((state) => state.enrollVoiceProfile);
  const reenrollVoiceProfile = useNotesStore((state) => state.reenrollVoiceProfile);
  const isDiarizerModelReady = useNotesStore((state) => state.isDiarizerModelReady);
  const downloadDiarizerModel = useNotesStore((state) => state.downloadDiarizerModel);

  useEffect(() => {
    loadVoiceProfiles();
  }, [loadVoiceProfiles]);

  const existingProfile = useMemo(
    () =>
      profileId == null ? null : (profiles.find((profile) => profile.id === profileId) ?? null),
    [profileId, profiles],
  );
  const isOwner = existingProfile ? existingProfile.isOwner === 1 : params.owner !== '0';
  const mode: VoiceEnrollmentMode = existingProfile ? 'retrain' : isOwner ? 'self' : 'other';
  const title =
    mode === 'self'
      ? 'Teach OpenWhispr your voice'
      : mode === 'other'
        ? "Add Someone's Voice"
        : isOwner
          ? 'Retrain Your Voice'
          : `Retrain ${existingProfile?.displayName}'s Voice`;

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(notes)/voice-profiles');
  }, [router]);

  const handleSubmit = useCallback(
    async (input: SubmitInput) => {
      try {
        if (existingProfile) {
          await reenrollVoiceProfile({ ...input, profileId: existingProfile.id });
        } else {
          await enrollVoiceProfile(input as EnrollVoiceProfileInput);
        }
      } catch (error) {
        if (error instanceof SpeakerProfileOwnerAlreadyExistsError) {
          Alert.alert(
            "You've already taught OpenWhispr your voice",
            'Open it in Voice Profiles and choose Retrain Voice.',
          );
        }
        throw error;
      }
    },
    [enrollVoiceProfile, existingProfile, reenrollVoiceProfile],
  );

  // A retrain link names a profile that loads after the first render.
  if (profileId != null && !existingProfile) {
    return <View className="flex-1 bg-systemBackground" />;
  }

  return (
    <View className="flex-1 bg-systemBackground">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        <Text accessibilityRole="header" className="mb-5 text-2xl font-bold text-label">
          {title}
        </Text>
        <VoiceEnrollmentRecorder
          mode={mode}
          isOwner={isOwner}
          profileId={existingProfile?.id}
          defaultDisplayName={existingProfile?.displayName ?? (isOwner ? 'Me' : '')}
          isModelReady={isDiarizerModelReady}
          downloadModel={downloadDiarizerModel}
          onSubmit={handleSubmit}
          onDone={leave}
          onCancel={leave}
        />
      </ScrollView>
    </View>
  );
}
