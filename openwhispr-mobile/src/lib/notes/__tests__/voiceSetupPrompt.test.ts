import type { Segment, Speaker } from '@/data/types';
import { shouldOfferVoiceSetup, voiceSetupCandidates } from '../voiceSetupPrompt';

const speaker = (overrides: Partial<Speaker> = {}): Speaker =>
  ({
    id: 10,
    noteId: 7,
    speakerLabel: 'speaker_0',
    displayName: null,
    profileId: null,
    color: null,
    sortOrder: 0,
    speakerStatus: 'provisional',
    speakerLocked: 0,
    speakerLockSource: null,
    clientId: null,
    remoteId: null,
    deletedAt: null,
    pendingSync: 0,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }) as Speaker;

const segment = (overrides: Partial<Segment> = {}): Segment =>
  ({
    id: 1,
    noteId: 7,
    startMs: 0,
    endMs: 6000,
    text: 'Hello there.',
    speakerLabel: 'speaker_0',
    sortOrder: 0,
    clientId: null,
    remoteId: null,
    deletedAt: null,
    pendingSync: 0,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }) as Segment;

const offer = (overrides: Partial<Parameters<typeof shouldOfferVoiceSetup>[0]> = {}) =>
  shouldOfferVoiceSetup({
    isOnDeviceMeeting: true,
    transcriptStatus: 'done',
    speakers: [speaker()],
    hasOwnerProfile: false,
    dismissed: false,
    ...overrides,
  });

describe('shouldOfferVoiceSetup', () => {
  it('offers setup on a finished on-device meeting with an unnamed speaker', () => {
    expect(offer()).toBe(true);
  });

  it('never offers it for a meeting not recorded on this device', () => {
    expect(offer({ isOnDeviceMeeting: false })).toBe(false);
  });

  it('waits until the transcript is done', () => {
    expect(offer({ transcriptStatus: 'diarizing' })).toBe(false);
  });

  it('stops once you have a voice profile or dismissed the banner', () => {
    expect(offer({ hasOwnerProfile: true })).toBe(false);
    expect(offer({ dismissed: true })).toBe(false);
  });

  it('needs at least one speaker that is still unnamed and unlinked', () => {
    expect(offer({ speakers: [speaker({ displayName: 'Alice' })] })).toBe(false);
    expect(offer({ speakers: [speaker({ profileId: 3 })] })).toBe(false);
    expect(offer({ speakers: [] })).toBe(false);
  });
});

describe('voiceSetupCandidates', () => {
  const speakers = [
    speaker({ id: 10, speakerLabel: 'speaker_0', sortOrder: 0 }),
    speaker({ id: 11, speakerLabel: 'speaker_1', sortOrder: 1 }),
  ];
  const segments = [
    segment({ id: 1, speakerLabel: 'speaker_0', startMs: 0, endMs: 6000, text: 'Short.' }),
    segment({
      id: 2,
      speakerLabel: 'speaker_0',
      startMs: 6000,
      endMs: 12000,
      text: 'The longest thing I said today.',
    }),
    segment({
      id: 3,
      speakerLabel: 'speaker_1',
      startMs: 12000,
      endMs: 40000,
      text: 'I talked for a long while.',
    }),
  ];
  const embeddingsByLabel = { speaker_0: [0.1, 0.2], speaker_1: [0.3, 0.4] };

  it('lists speakers with 10 s of speech and a sample, longest speaker first', () => {
    expect(voiceSetupCandidates({ segments, speakers, embeddingsByLabel })).toEqual([
      {
        speakerId: 11,
        name: 'Speaker 2',
        speechMs: 28000,
        sampleLine: 'I talked for a long while.',
      },
      {
        speakerId: 10,
        name: 'Speaker 1',
        speechMs: 12000,
        sampleLine: 'The longest thing I said today.',
      },
    ]);
  });

  it('leaves out speakers under 10 s of speech', () => {
    const short = [segment({ speakerLabel: 'speaker_0', startMs: 0, endMs: 9999 })];
    expect(voiceSetupCandidates({ segments: short, speakers, embeddingsByLabel })).toEqual([]);
  });

  it('leaves out speakers without a sample from this meeting', () => {
    expect(
      voiceSetupCandidates({ segments, speakers, embeddingsByLabel: { speaker_1: [] } }),
    ).toEqual([]);
    expect(voiceSetupCandidates({ segments, speakers, embeddingsByLabel: undefined })).toEqual([]);
  });

  it('leaves out speakers already linked to a voice profile', () => {
    const linked = [speaker({ id: 11, speakerLabel: 'speaker_1', profileId: 4 })];
    expect(voiceSetupCandidates({ segments, speakers: linked, embeddingsByLabel })).toEqual([]);
  });
});
