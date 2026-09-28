import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { VoiceEnrollmentRecorder } from '@/components/notes/VoiceEnrollmentRecorder';
import { useNotesStore } from '@/store/useNotesStore';
import { SpeakerProfileOwnerAlreadyExistsError } from '@/data/local/notesRepository';
import type {
  EnrollVoiceProfileInput,
  ReenrollVoiceProfileInput,
} from '@/services/diarization/VoiceprintService';

type SubmitInput = EnrollVoiceProfileInput | ReenrollVoiceProfileInput;

export default function VoiceEnrollmentScreen() {
  const params = useLocalSearchParams<{ owner?: string; profileId?: string; noteId?: string }>();
  const router = useRouter();
  const profiles = useNotesStore((state) => state.voiceProfiles);
  // Teaching your voice when you already have a profile retrains that one, instead of a
  // full read that ends in "already taught". Read once, so saving a new one mid-screen
  // doesn't turn this into a retrain.
  const [ownerProfileIdAtOpen] = useState(() =>
    params.owner !== '0' && !params.profileId
      ? (profiles.find((profile) => profile.isOwner === 1)?.id ?? null)
      : null,
  );
  const profileId = params.profileId ? Number(params.profileId) : ownerProfileIdAtOpen;
  const noteId = params.noteId ? Number(params.noteId) : null;
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const loadVoiceProfiles = useNotesStore((state) => state.loadVoiceProfiles);
  const enrollVoiceProfile = useNotesStore((state) => state.enrollVoiceProfile);
  const reenrollVoiceProfile = useNotesStore((state) => state.reenrollVoiceProfile);
  const relabelMeetingSpeakers = useNotesStore((state) => state.relabelMeetingSpeakers);
  const isDiarizerModelReady = useNotesStore((state) => state.isDiarizerModelReady);
  const downloadDiarizerModel = useNotesStore((state) => state.downloadDiarizerModel);

  useEffect(() => {
    loadVoiceProfiles();
    setProfilesLoaded(true);
  }, [loadVoiceProfiles]);

  const existingProfile = useMemo(
    () =>
      profileId == null ? null : (profiles.find((profile) => profile.id === profileId) ?? null),
    [profileId, profiles],
  );
  const isOwner = existingProfile ? existingProfile.isOwner === 1 : params.owner !== '0';
  const title = existingProfile
    ? isOwner
      ? 'Retrain Your Voice'
      : `Retrain ${existingProfile.displayName}'s Voice`
    : isOwner
      ? 'Teach OpenWhispr your voice'
      : "Add Someone's Voice";

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
          leave();
        }
        throw error;
      }
      // Started from a meeting note: label that meeting with the new voice as well.
      if (noteId != null) relabelMeetingSpeakers(noteId);
    },
    [
      enrollVoiceProfile,
      existingProfile,
      leave,
      noteId,
      reenrollVoiceProfile,
      relabelMeetingSpeakers,
    ],
  );

  if (profileId != null && !existingProfile) {
    // Profiles load in the first effect; after that a missing one was deleted.
    if (!profilesLoaded) return <View className="flex-1 bg-systemBackground" />;
    return (
      <View className="flex-1 gap-4 bg-systemBackground p-4" testID="voice-enrollment-missing">
        <Text className="text-[15px] leading-5 text-secondaryLabel">
          This voice profile no longer exists.
        </Text>
        <Button onPress={leave}>Back</Button>
      </View>
    );
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
