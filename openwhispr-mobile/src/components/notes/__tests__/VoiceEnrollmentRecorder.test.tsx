import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { VoiceEnrollmentRecorder } from '../VoiceEnrollmentRecorder';
import { useAudioRecording } from '@/hooks/useAudioRecording';
import {
  VOICE_ENROLLMENT_LOW_SNR,
  VoiceEnrollmentError,
} from '@/services/diarization/VoiceprintService';

jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/ui/SystemIcon', () => ({ SystemIcon: () => null }));
jest.mock('@/components/features/WaveformVisualizer', () => ({ WaveformVisualizer: () => null }));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: () => null,
  Circle: () => null,
}));
jest.mock('@/hooks/useAudioWaveform', () => ({
  useAudioWaveform: () => ({ currentAmplitude: 0, waveformData: [] }),
}));
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: jest.fn(async () => undefined) }));
jest.mock('@/components/ui/Button', () => {
  const mockReact = require('react');
  const mockText = require('react-native').Text;
  return {
    Button: function MockButton(props: any) {
      return mockReact.createElement(
        mockText,
        {
          onPress: props.disabled ? undefined : props.onPress,
          testID: props.testID,
          accessibilityState: { disabled: !!props.disabled },
        },
        props.children,
      );
    },
  };
});
jest.mock('@/hooks/useAudioRecording', () => ({ useAudioRecording: jest.fn() }));

const mockUseAudioRecording = useAudioRecording as jest.MockedFunction<typeof useAudioRecording>;
const startRecording = jest.fn(async () => undefined);
const stopRecordingRaw = jest.fn(async (): Promise<string | null> => 'file://sample.wav');
const cancelRecording = jest.fn();

const renderRecorder = (overrides: Partial<Parameters<typeof VoiceEnrollmentRecorder>[0]> = {}) => {
  const props = {
    mode: 'self' as const,
    isOwner: true,
    isModelReady: jest.fn(async () => true),
    downloadModel: jest.fn(async () => undefined),
    onSubmit: jest.fn(async () => undefined),
    onDone: jest.fn(),
    onCancel: jest.fn(),
    now: () => new Date('2026-09-27T09:00:00.000Z'),
    ...overrides,
  };
  return { props, ...render(<VoiceEnrollmentRecorder {...props} />) };
};

const recordFor = async (
  utils: ReturnType<typeof renderRecorder>,
  seconds: number,
): Promise<void> => {
  await waitFor(() => expect(utils.getByTestId('voice-enrollment-record')).toBeTruthy());
  await act(async () => {
    fireEvent.press(utils.getByTestId('voice-enrollment-record'));
  });
  await act(async () => {
    jest.advanceTimersByTime(seconds * 1000);
  });
};

// Mirrors the real hook: useAudioRecorder's releasing cleanup is declared before the
// recorder component's own effects, so on unmount it releases the native recorder first,
// and every property read after that throws NativeSharedObjectNotFoundException.
const mockReleasingRecorder = (waitForStop: () => Promise<void> = async () => undefined) => {
  let released = false;
  let recordingNow = false;
  const read = <T,>(value: T): T => {
    if (released) throw new Error('NativeSharedObjectNotFoundException');
    return value;
  };
  const audioRecorder = {
    get uri() {
      return read('file://partial.wav');
    },
    get isRecording() {
      return read(recordingNow);
    },
  } as unknown as ReturnType<typeof useAudioRecording>['audioRecorder'];
  const recording = {
    ...mockUseAudioRecording(),
    startRecording: jest.fn(async () => {
      recordingNow = true;
    }),
    cancelRecording: jest.fn(async () => {
      if (audioRecorder.isRecording) recordingNow = false;
    }),
    stopRecordingRaw: jest.fn(async () => {
      if (!audioRecorder.isRecording) return null;
      await waitForStop();
      recordingNow = false;
      return audioRecorder.uri ?? null;
    }),
    audioRecorder,
  };
  mockUseAudioRecording.mockImplementation(() => {
    require('react').useEffect(
      () => () => {
        released = true;
      },
      [],
    );
    return recording;
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockUseAudioRecording.mockReturnValue({
    isRecording: false,
    isProcessing: false,
    currentText: '',
    isSupported: true,
    startRecording,
    stopRecording: jest.fn(),
    stopRecordingRaw,
    cancelRecording,
    audioRecorder: {} as ReturnType<typeof useAudioRecording>['audioRecorder'],
  });
});
afterEach(() => jest.useRealTimers());

describe('VoiceEnrollmentRecorder', () => {
  it('asks before downloading the speaker model, and Not Now downloads nothing', async () => {
    const utils = renderRecorder({ isModelReady: jest.fn(async () => false) });
    await waitFor(() => expect(utils.getByText('Download the speaker model')).toBeTruthy());
    expect(utils.queryByTestId('voice-enrollment-record')).toBeNull();

    fireEvent.press(utils.getByTestId('voice-enrollment-not-now'));

    expect(utils.props.onCancel).toHaveBeenCalled();
    expect(utils.props.downloadModel).not.toHaveBeenCalled();
  });

  it('lets you read while the model downloads, then checks once it has finished', async () => {
    let finishDownload: () => void = () => {};
    const downloadModel = jest.fn(() => new Promise<void>((resolve) => (finishDownload = resolve)));
    const utils = renderRecorder({ isModelReady: jest.fn(async () => false), downloadModel });
    await waitFor(() => expect(utils.getByTestId('voice-enrollment-download')).toBeTruthy());
    fireEvent.press(utils.getByTestId('voice-enrollment-download'));
    expect(utils.getByTestId('voice-enrollment-downloading')).toBeTruthy();

    await recordFor(utils, 12);
    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-stop'));
    });
    expect(utils.getByTestId('voice-enrollment-checking')).toBeTruthy();
    expect(utils.props.onSubmit).not.toHaveBeenCalled();

    await act(async () => finishDownload());
    await waitFor(() => expect(utils.props.onSubmit).toHaveBeenCalledTimes(1));
  });

  it('deletes a recording waiting on the download when you leave, and never submits it', async () => {
    let finishDownload: () => void = () => {};
    const downloadModel = jest.fn(() => new Promise<void>((resolve) => (finishDownload = resolve)));
    const utils = renderRecorder({ isModelReady: jest.fn(async () => false), downloadModel });
    await waitFor(() => expect(utils.getByTestId('voice-enrollment-download')).toBeTruthy());
    fireEvent.press(utils.getByTestId('voice-enrollment-download'));

    await recordFor(utils, 12);
    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-stop'));
    });
    expect(utils.getByTestId('voice-enrollment-checking')).toBeTruthy();

    utils.unmount();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file://sample.wav', { idempotent: true });

    await act(async () => finishDownload());
    expect(utils.props.onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the recording when the download fails and checks it after a retry', async () => {
    const downloadModel = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const utils = renderRecorder({ isModelReady: jest.fn(async () => false), downloadModel });
    await waitFor(() => expect(utils.getByTestId('voice-enrollment-download')).toBeTruthy());
    fireEvent.press(utils.getByTestId('voice-enrollment-download'));

    await recordFor(utils, 12);
    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-stop'));
    });
    await waitFor(() => expect(utils.getByTestId('voice-enrollment-download-retry')).toBeTruthy());
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-download-retry'));
    });

    await waitFor(() =>
      expect(utils.props.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          recordings: [{ uri: 'file://sample.wav', mimeType: 'audio/wav' }],
        }),
      ),
    );
  });

  it('enables Done at 10 seconds and stops by itself at 30', async () => {
    const utils = renderRecorder();
    await recordFor(utils, 9);
    expect(utils.getByTestId('voice-enrollment-stop').props.accessibilityState.disabled).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(utils.getByTestId('voice-enrollment-stop').props.accessibilityState.disabled).toBe(
      false,
    );

    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    await waitFor(() => expect(stopRecordingRaw).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(utils.props.onSubmit).toHaveBeenCalledTimes(1));
  });

  it('stops and submits once when Done and the 30 s limit coincide', async () => {
    const utils = renderRecorder();
    await recordFor(utils, 29);
    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-stop'));
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => expect(utils.props.onSubmit).toHaveBeenCalledTimes(1));
    expect(stopRecordingRaw).toHaveBeenCalledTimes(1);
  });

  it('submits one sample with the consent time and shows success', async () => {
    const utils = renderRecorder();
    await recordFor(utils, 12);
    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-stop'));
    });

    await waitFor(() =>
      expect(utils.props.onSubmit).toHaveBeenCalledWith({
        recordings: [{ uri: 'file://sample.wav', mimeType: 'audio/wav' }],
        displayName: 'Me',
        isOwner: true,
        consentAccepted: true,
        consentAcceptedAt: '2026-09-27T09:00:00.000Z',
      }),
    );
    expect(utils.getByText('Future on-device meetings will label you as Me.')).toBeTruthy();
    fireEvent.press(utils.getByTestId('voice-enrollment-done'));
    expect(utils.props.onDone).toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file://sample.wav', { idempotent: true });
  });

  it('explains a failed sample and lets you try again', async () => {
    const onSubmit = jest.fn(async () => {
      throw new VoiceEnrollmentError(VOICE_ENROLLMENT_LOW_SNR, 'snr');
    });
    const utils = renderRecorder({ onSubmit });
    await recordFor(utils, 12);
    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-stop'));
    });

    await waitFor(() =>
      expect(utils.getByText('Too much background noise. Try somewhere quieter.')).toBeTruthy(),
    );
    fireEvent.press(utils.getByTestId('voice-enrollment-try-again'));
    expect(utils.queryByTestId('voice-enrollment-error')).toBeNull();
    expect(utils.getByTestId('voice-enrollment-record')).toBeTruthy();
  });

  it('shows a failure and Try Again when the microphone cannot start', async () => {
    startRecording.mockRejectedValueOnce(new Error('Microphone permission denied'));
    const utils = renderRecorder();
    await waitFor(() => expect(utils.getByTestId('voice-enrollment-record')).toBeTruthy());
    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-record'));
    });

    expect(utils.getByTestId('voice-enrollment-error')).toBeTruthy();
    expect(utils.getByText(/couldn't start the microphone/i)).toBeTruthy();
    expect(utils.getByTestId('voice-enrollment-try-again')).toBeTruthy();
  });

  it('cancels the recording and deletes it when you leave mid-read', async () => {
    mockUseAudioRecording.mockReturnValue({
      ...mockUseAudioRecording(),
      audioRecorder: { uri: 'file://partial.wav' } as ReturnType<
        typeof useAudioRecording
      >['audioRecorder'],
    });
    const utils = renderRecorder();
    await recordFor(utils, 5);
    utils.unmount();
    expect(cancelRecording).toHaveBeenCalled();

    await act(async () => undefined);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file://partial.wav', { idempotent: true });
  });

  it('deletes the recording and never submits it when you leave while it is stopping', async () => {
    let finishStop: (uri: string) => void = () => {};
    stopRecordingRaw.mockImplementationOnce(
      () => new Promise<string>((resolve) => (finishStop = resolve)),
    );
    const utils = renderRecorder();
    await recordFor(utils, 12);
    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-stop'));
    });

    utils.unmount();
    await act(async () => finishStop('file://sample.wav'));

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file://sample.wav', { idempotent: true });
    expect(utils.props.onSubmit).not.toHaveBeenCalled();
  });

  it('deletes the sample when you leave mid-read, after the recorder is released', async () => {
    mockReleasingRecorder();
    const utils = renderRecorder();
    await recordFor(utils, 5);

    utils.unmount();
    await act(async () => undefined);

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file://partial.wav', { idempotent: true });
  });

  it('deletes the sample when you leave mid-stop, after the recorder is released', async () => {
    let finishStop: () => void = () => {};
    mockReleasingRecorder(() => new Promise<void>((resolve) => (finishStop = resolve)));
    const utils = renderRecorder();
    await recordFor(utils, 12);
    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-stop'));
    });

    utils.unmount();
    await act(async () => finishStop());

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file://partial.wav', { idempotent: true });
    expect(utils.props.onSubmit).not.toHaveBeenCalled();
  });

  it('never deletes a sample already handed to onSubmit when you leave', async () => {
    let finishSubmit: () => void = () => {};
    mockReleasingRecorder();
    const onSubmit = jest.fn(() => new Promise<void>((resolve) => (finishSubmit = resolve)));
    const utils = renderRecorder({ onSubmit });
    await recordFor(utils, 12);
    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-stop'));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    utils.unmount();
    await act(async () => undefined);
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();

    await act(async () => finishSubmit());
    expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['returns no file', async () => null],
    [
      'fails',
      async () => {
        throw new Error('stop failed');
      },
    ],
  ])('deletes the sample and shows a failure when stopping %s', async (_label, stopResult) => {
    stopRecordingRaw.mockImplementationOnce(stopResult);
    mockUseAudioRecording.mockReturnValue({
      ...mockUseAudioRecording(),
      audioRecorder: { uri: 'file://partial.wav' } as ReturnType<
        typeof useAudioRecording
      >['audioRecorder'],
    });
    const utils = renderRecorder();
    await recordFor(utils, 12);
    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-stop'));
    });

    expect(utils.getByTestId('voice-enrollment-error')).toBeTruthy();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file://partial.wav', { idempotent: true });
    expect(utils.props.onSubmit).not.toHaveBeenCalled();
  });

  it('starts one recording when the mic is tapped twice while it opens', async () => {
    let finishStart: () => void = () => {};
    startRecording.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (finishStart = () => resolve(undefined))),
    );
    const utils = renderRecorder();
    await waitFor(() => expect(utils.getByTestId('voice-enrollment-record')).toBeTruthy());

    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-record'));
      fireEvent.press(utils.getByTestId('voice-enrollment-record'));
    });
    await act(async () => finishStart());

    expect(startRecording).toHaveBeenCalledTimes(1);
    expect(utils.getByTestId('voice-enrollment-stop')).toBeTruthy();
  });

  it("needs a name before recording someone else's voice", async () => {
    const utils = renderRecorder({ mode: 'other', isOwner: false });
    await waitFor(() => expect(utils.getByTestId('voice-enrollment-record')).toBeTruthy());
    expect(utils.getByTestId('voice-enrollment-record').props.accessibilityState.disabled).toBe(
      true,
    );

    fireEvent.changeText(utils.getByTestId('voice-enrollment-name'), 'Alice');
    await recordFor(utils, 12);
    await act(async () => {
      fireEvent.press(utils.getByTestId('voice-enrollment-stop'));
    });

    await waitFor(() =>
      expect(utils.props.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'Alice', isOwner: false }),
      ),
    );
    expect(utils.getByText('Future on-device meetings will label Alice.')).toBeTruthy();
  });
});
