import { act, fireEvent, render } from '@testing-library/react-native';
import { VoiceSetupBanner } from '../VoiceSetupBanner';
import { ThatsMeSheet } from '../ThatsMeSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/ui/SystemIcon', () => ({ SystemIcon: () => null }));
jest.mock('@/components/ui/GlassIconButton', () => ({
  GlassIconButton: ({ onPress, accessibilityLabel }: any) =>
    require('react').createElement(require('react-native').Pressable, {
      onPress,
      accessibilityLabel,
    }),
}));

const candidates = [
  { speakerId: 11, name: 'Speaker 2', speechMs: 65000, sampleLine: 'Let us ship on Friday.' },
  { speakerId: 10, name: 'Speaker 1', speechMs: 12000, sampleLine: 'Sounds good.' },
];

describe('VoiceSetupBanner', () => {
  it('explains the benefit and offers set up and dismiss', () => {
    const onSetUp = jest.fn();
    const onDismiss = jest.fn();
    const { getByText, getByTestId } = render(
      <VoiceSetupBanner onSetUp={onSetUp} onDismiss={onDismiss} />,
    );

    expect(getByText('Teach OpenWhispr your voice')).toBeTruthy();
    expect(getByText('Your next meetings will label you as Me instead of Speaker 1.')).toBeTruthy();
    fireEvent.press(getByTestId('voice-setup-banner-set-up'));
    fireEvent.press(getByTestId('voice-setup-banner-dismiss'));

    expect(onSetUp).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('ThatsMeSheet', () => {
  const baseProps = {
    visible: true,
    candidates,
    onClaim: jest.fn(() => true),
    onReadScript: jest.fn(),
    onClose: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('lists each speaker with how long they spoke and what they said', () => {
    const { getByText } = render(<ThatsMeSheet {...baseProps} />);

    expect(getByText('Which speaker is you?')).toBeTruthy();
    expect(getByText('Speaker 2')).toBeTruthy();
    expect(getByText('Spoke for 1:05')).toBeTruthy();
    expect(getByText('“Let us ship on Friday.”')).toBeTruthy();
  });

  it('claims the tapped speaker and confirms', () => {
    const { getByTestId, getByText } = render(<ThatsMeSheet {...baseProps} />);

    fireEvent.press(getByTestId('thats-me-11'));

    expect(baseProps.onClaim).toHaveBeenCalledWith(11);
    expect(getByText('Got it')).toBeTruthy();
    fireEvent.press(getByTestId('thats-me-done'));
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it("keeps the first claim when That's me is tapped twice before it re-renders", () => {
    // The second call would fail: the first one already saved the owner profile.
    const onClaim = jest.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const { getByTestId, getByText } = render(<ThatsMeSheet {...baseProps} onClaim={onClaim} />);
    const button = getByTestId('thats-me-11');

    act(() => {
      fireEvent.press(button);
      fireEvent.press(button);
    });

    expect(onClaim).toHaveBeenCalledTimes(1);
    expect(getByText('Got it')).toBeTruthy();
  });

  it('stays on the list when the claim fails', () => {
    const onClaim = jest.fn(() => false);
    const { getByTestId, queryByText } = render(<ThatsMeSheet {...baseProps} onClaim={onClaim} />);

    fireEvent.press(getByTestId('thats-me-11'));

    expect(queryByText('Got it')).toBeNull();
    expect(getByTestId('thats-me-read-script')).toBeTruthy();
  });

  it('offers only the script when no speaker has a sample', () => {
    const { getByTestId, queryByTestId, getByText } = render(
      <ThatsMeSheet {...baseProps} candidates={[]} />,
    );

    expect(queryByTestId('thats-me-11')).toBeNull();
    expect(getByText(/doesn't have a voice sample from this meeting/)).toBeTruthy();
    fireEvent.press(getByTestId('thats-me-read-script'));
    expect(baseProps.onReadScript).toHaveBeenCalled();
  });

  it('shows the privacy note that the tap agrees to', () => {
    const { getByText } = render(<ThatsMeSheet {...baseProps} />);
    expect(
      getByText(
        'Your voice profile stays on this device and is only used to recognize you in meetings you record. You can delete it in Voice Profiles.',
      ),
    ).toBeTruthy();
  });
});
