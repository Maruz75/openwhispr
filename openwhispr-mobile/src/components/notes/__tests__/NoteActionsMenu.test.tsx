import { fireEvent, render } from '@testing-library/react-native';
import { NoteActionsMenu } from '../NoteActionsMenu';

jest.mock('@react-native-menu/menu', () => ({
  MenuView: ({
    actions,
    onPressAction,
    children,
  }: {
    actions: { id: string; title: string }[];
    onPressAction: (event: { nativeEvent: { event: string } }) => void;
    children?: React.ReactNode;
  }) => {
    const { Pressable, Text, View } = require('react-native');
    return (
      <View>
        {children}
        {actions.map((action) => (
          <Pressable
            key={action.id}
            testID={`menu-${action.id}`}
            onPress={() => onPressAction({ nativeEvent: { event: action.id } })}
          >
            <Text>{action.title}</Text>
          </Pressable>
        ))}
      </View>
    );
  },
}));
jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));
jest.mock('@/components/ui/SystemIcon', () => ({ SystemIcon: () => null }));
jest.mock('@/components/ui/GlassIconButton', () => ({
  GlassCapsule: ({ children }: { children?: React.ReactNode }) => {
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));
jest.mock('@/store/useNotesStore', () => {
  const state = { notes: [], setNotePrivacy: jest.fn() };
  return {
    useNotesStore: (selector: (s: typeof state) => unknown) => selector(state),
  };
});

const baseProps = {
  noteId: 7,
  actions: [],
  hasContent: true,
  isRecording: false,
  processing: false,
  onRunAction: jest.fn(),
  onManageActions: jest.fn(),
  onShare: jest.fn(),
  onDelete: jest.fn(),
};

describe('NoteActionsMenu', () => {
  it('opens the transcript from View Transcript', () => {
    const onViewTranscript = jest.fn();
    const { getByTestId, getByText } = render(
      <NoteActionsMenu {...baseProps} onViewTranscript={onViewTranscript} />,
    );
    expect(getByText('View Transcript')).toBeTruthy();
    fireEvent.press(getByTestId('menu-__view_transcript'));
    expect(onViewTranscript).toHaveBeenCalled();
  });

  it('has no transcript item for a note without a transcript', () => {
    const { queryByText } = render(<NoteActionsMenu {...baseProps} />);
    expect(queryByText('View Transcript')).toBeNull();
    expect(queryByText('Copy Transcript')).toBeNull();
  });
});
