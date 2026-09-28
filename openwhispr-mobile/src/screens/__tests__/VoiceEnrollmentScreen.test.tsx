import { Alert } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import VoiceEnrollmentScreen from '../VoiceEnrollmentScreen';
import { SpeakerProfileOwnerAlreadyExistsError } from '@/data/local/notesRepository';

let mockParams: Record<string, string> = {};
let mockRecorderProps: any = null;
const mockBack = jest.fn();
const mockEnroll = jest.fn();
const mockState = {
  voiceProfiles: [] as any[],
  loadVoiceProfiles: jest.fn(),
  enrollVoiceProfile: mockEnroll,
  reenrollVoiceProfile: jest.fn(),
  isDiarizerModelReady: jest.fn(async () => true),
  downloadDiarizerModel: jest.fn(async () => undefined),
};

jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack, canGoBack: () => true, replace: jest.fn() }),
}));
jest.mock('@/store/useNotesStore', () => ({
  useNotesStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));
jest.mock('@/data/local/notesRepository', () => {
  class SpeakerProfileOwnerAlreadyExistsError extends Error {}
  return { SpeakerProfileOwnerAlreadyExistsError };
});
jest.mock('@/components/notes/VoiceEnrollmentRecorder', () => ({
  VoiceEnrollmentRecorder: (props: any) => {
    mockRecorderProps = props;
    return null;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockRecorderProps = null;
  mockState.voiceProfiles = [];
});

describe('VoiceEnrollmentScreen', () => {
  it('teaches your own voice by default', () => {
    mockParams = { owner: '1' };
    const { getByText } = render(<VoiceEnrollmentScreen />);
    expect(getByText('Teach OpenWhispr your voice')).toBeTruthy();
    expect(mockRecorderProps).toMatchObject({ mode: 'self', isOwner: true });
  });

  it("adds someone else's voice", () => {
    mockParams = { owner: '0' };
    const { getByText } = render(<VoiceEnrollmentScreen />);
    expect(getByText("Add Someone's Voice")).toBeTruthy();
    expect(mockRecorderProps).toMatchObject({ mode: 'other', isOwner: false });
  });

  it('retrains an existing profile', () => {
    mockParams = { profileId: '2' };
    mockState.voiceProfiles = [{ id: 2, displayName: 'Me', isOwner: 1 }];
    const { getByText } = render(<VoiceEnrollmentScreen />);
    expect(getByText('Retrain Your Voice')).toBeTruthy();
    expect(mockRecorderProps).toMatchObject({ mode: 'retrain', profileId: 2 });
  });

  it('waits for the profile before choosing what to show', () => {
    mockParams = { profileId: '2' };
    render(<VoiceEnrollmentScreen />);
    expect(mockRecorderProps).toBeNull();
  });

  it('explains when you already taught it your voice', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockParams = { owner: '1' };
    mockEnroll.mockRejectedValueOnce(new SpeakerProfileOwnerAlreadyExistsError());
    render(<VoiceEnrollmentScreen />);

    await expect(mockRecorderProps.onSubmit({})).rejects.toBeInstanceOf(
      SpeakerProfileOwnerAlreadyExistsError,
    );
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "You've already taught OpenWhispr your voice",
        'Open it in Voice Profiles and choose Retrain Voice.',
      ),
    );
    alertSpy.mockRestore();
  });
});
