import { Alert, Share, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { TranscriptBlock } from '@/lib/diarization/transcriptDisplay';
import { TranscriptSheet } from '../TranscriptSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/ui/SystemIcon', () => ({ SystemIcon: () => null }));
jest.mock('@/components/ui/GlassIconButton', () => ({
  GlassIconButton: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
  }) => {
    const { Pressable } = require('react-native');
    return (
      <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress}>
        {children}
      </Pressable>
    );
  },
}));

const block: TranscriptBlock = {
  id: 'b1',
  speakerId: 10,
  speakerLabel: 'speaker_0',
  speakerName: 'Speaker 1',
  speakerColor: '#FF0000',
  speakerStatus: 'provisional',
  startMs: 0,
  endMs: 1000,
  timestamp: '0:00',
  text: 'Hello there',
  segmentIds: [1],
};

const renderSheet = (overrides: Partial<React.ComponentProps<typeof TranscriptSheet>> = {}) =>
  render(
    <TranscriptSheet
      visible
      blocks={[block]}
      selectedSpeakerId={null}
      shareText="[0:00] Speaker 1: Hello there"
      onSpeakerPress={jest.fn()}
      onClose={jest.fn()}
      {...overrides}
    />,
  );

describe('TranscriptSheet', () => {
  it('shows the title, subtitle and transcript', () => {
    const { getByText } = renderSheet();
    expect(getByText('Transcript')).toBeTruthy();
    expect(getByText('Review or share the full meeting transcript.')).toBeTruthy();
    expect(getByText('Hello there')).toBeTruthy();
  });

  it('hands a tapped speaker to the caller', () => {
    const onSpeakerPress = jest.fn();
    const { getByTestId } = renderSheet({ onSpeakerPress });
    fireEvent.press(getByTestId('speaker-button-10'));
    expect(onSpeakerPress).toHaveBeenCalledWith(block);
  });

  it('opens the share sheet with the transcript text', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const { getByLabelText } = renderSheet();
    await act(async () => {
      fireEvent.press(getByLabelText('Share transcript'));
    });
    expect(shareSpy).toHaveBeenCalledWith({ message: '[0:00] Speaker 1: Hello there' });
    shareSpy.mockRestore();
  });

  it('explains when sharing fails', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockRejectedValue(new Error('nope'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = renderSheet();
    await act(async () => {
      fireEvent.press(getByLabelText('Share transcript'));
    });
    expect(alertSpy).toHaveBeenCalledWith('Error', 'Unable to share transcript');
    shareSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('closes from the close button', () => {
    const onClose = jest.fn();
    const { getByLabelText } = renderSheet({ onClose });
    fireEvent.press(getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders its children inside the sheet so speaker sheets can present above it', () => {
    const { getByText } = renderSheet({ children: <Text>rename-sheet</Text> });
    expect(getByText('rename-sheet')).toBeTruthy();
  });
});
