import { fireEvent, render } from '@testing-library/react-native';
import type { SpeakerProfile } from '@/data/types';
import { VoiceProfileList } from '../VoiceProfileList';

jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/ui/SystemIcon', () => ({ SystemIcon: () => null }));
jest.mock('@/components/ui/SwipeableCard', () => ({
  SwipeableCard: ({ children }: any) => children,
}));
jest.mock('../SectionHeader', () => ({ SectionHeader: () => null }));

const profile = (overrides: Partial<SpeakerProfile> = {}): SpeakerProfile =>
  ({
    id: 1,
    displayName: 'Me',
    email: null,
    isOwner: 1,
    embedding: [1, 0],
    sampleCount: 2,
    consentAt: '2026-06-19T12:00:00.000Z',
    createdAt: '2026-06-19 12:00:00',
    updatedAt: null,
    ...overrides,
  }) as SpeakerProfile;

const baseListProps = {
  onEnrollOwner: jest.fn(),
  onEnrollSpeaker: jest.fn(),
  onOpenProfile: jest.fn(),
  onDelete: jest.fn(),
};

describe('VoiceProfileList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders owner badge and opens the profile on row press', () => {
    const onOpenProfile = jest.fn();
    const { getByText, getByTestId } = render(
      <VoiceProfileList profiles={[profile()]} {...baseListProps} onOpenProfile={onOpenProfile} />,
    );

    expect(getByText('Owner')).toBeTruthy();

    fireEvent.press(getByTestId('voice-profile-row-1'));

    expect(onOpenProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('offers owner enrollment in the empty state', () => {
    const onEnrollOwner = jest.fn();
    const { getByTestId, getByText } = render(
      <VoiceProfileList profiles={[]} {...baseListProps} onEnrollOwner={onEnrollOwner} />,
    );

    expect(getByText('Label speakers automatically')).toBeTruthy();
    expect(getByText(/works with on-device transcription/i)).toBeTruthy();
    // Worded like the Enroll Me row and prompt card.
    expect(getByText('Enroll Me')).toBeTruthy();
    fireEvent.press(getByTestId('voice-profile-enroll-owner-empty'));

    expect(onEnrollOwner).toHaveBeenCalled();
  });

  it('hides the owner enrollment action once an owner exists', () => {
    const { queryByTestId, getByTestId } = render(
      <VoiceProfileList
        profiles={[profile(), profile({ id: 2, displayName: 'Alice', isOwner: 0 })]}
        {...baseListProps}
      />,
    );

    expect(queryByTestId('voice-profile-enroll-owner')).toBeNull();
    expect(getByTestId('voice-profile-enroll-speaker')).toBeTruthy();
  });
});
