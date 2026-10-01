import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/sentry', () => ({ Sentry: { captureException: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/ui/SystemIcon', () => ({ SystemIcon: () => null }));

const mockGoNext = jest.fn();
jest.mock('@/store/useOnboardingStore', () => ({
  useOnboardingStore: (selector: (s: { goNext: () => Promise<void> }) => unknown) =>
    selector({ goNext: mockGoNext }),
  getStepProgress: () => ({ current: 1, total: 1 }),
}));

const mockRegister = jest.fn();
type MockGate = { isConfigured: boolean; state: { status: string } };
let mockGate: MockGate = { isConfigured: true, state: { status: 'idle' } };
jest.mock('@/hooks/useSuperwallGate', () => ({
  useSuperwallGate: () => ({ register: mockRegister, ...mockGate }),
}));

type MockAuthState = { user: { id: string; isAnonymous: boolean } | null };
let mockAuthState: MockAuthState = { user: { id: 'anon-user', isAnonymous: true } };
jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: (selector: (s: MockAuthState) => unknown) => selector(mockAuthState),
}));

type MockUsage = { isSubscribed: boolean };
type MockUsageState = { usage: MockUsage | null; isLoading: boolean };
let mockUsageState: MockUsageState = { usage: null, isLoading: false };
const mockLoad = jest.fn();
const mockUsageListeners = new Set<(state: MockUsageState) => void>();
jest.mock('@/store/useUsageStore', () => ({
  useUsageStore: Object.assign(
    (selector: (s: MockUsageState) => unknown) => selector(mockUsageState),
    {
      getState: () => ({ ...mockUsageState, load: mockLoad }),
      subscribe: (listener: (state: MockUsageState) => void) => {
        mockUsageListeners.add(listener);
        return () => mockUsageListeners.delete(listener);
      },
    },
  ),
}));

function setMockUsageState(next: MockUsageState): void {
  mockUsageState = next;
  mockUsageListeners.forEach((listener) => listener(mockUsageState));
}

const FREE: MockUsage = { isSubscribed: false };
const SUBSCRIBED: MockUsage = { isSubscribed: true };

import { PAYWALL_ESCAPE_MS, PAYWALL_READY_GRACE_MS, PaywallStep } from '../PaywallStep';
import { SUPERWALL_PLACEMENTS } from '@/lib/superwall';

beforeEach(() => {
  jest.clearAllMocks();
  mockGoNext.mockResolvedValue(undefined);
  mockRegister.mockResolvedValue(true);
  mockAuthState = { user: { id: 'anon-user', isAnonymous: true } };
  mockUsageState = { usage: null, isLoading: false };
  mockUsageListeners.clear();
  mockLoad.mockResolvedValue({ status: 'loaded', usage: FREE, loadedAt: 1 });
  mockGate = { isConfigured: true, state: { status: 'idle' } };
});

afterEach(() => {
  jest.useRealTimers();
});

describe('PaywallStep', () => {
  it('presents the onboarding placement on mount', async () => {
    render(<PaywallStep />);

    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    expect(mockRegister.mock.calls[0][0].placement).toBe(SUPERWALL_PLACEMENTS.onboardingPaywall);
  });

  it('advances to the saved setup destination once the paywall closes', async () => {
    render(<PaywallStep />);

    await waitFor(() => expect(mockGoNext).toHaveBeenCalledTimes(1));
  });

  // The property that matters most here: nothing about Superwall may strand a
  // first run. A rejected register still has to hand off to the saved setup destination.
  it('advances even when the paywall fails to present', async () => {
    mockRegister.mockRejectedValue(new Error('Superwall unavailable'));

    render(<PaywallStep />);

    await waitFor(() => expect(mockGoNext).toHaveBeenCalledTimes(1));
  });

  it('offers a working escape once a paywall that never resolves has had its chance', async () => {
    jest.useFakeTimers();
    mockRegister.mockReturnValue(new Promise<boolean>(() => {}));

    const { getByText } = render(<PaywallStep />);
    await act(async () => {});
    expect(mockRegister).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(PAYWALL_ESCAPE_MS);
    });
    await act(async () => {
      fireEvent.press(getByText('Continue'));
    });

    expect(mockGoNext).toHaveBeenCalledTimes(1);
    expect(mockRegister.mock.calls[0][0].signal.aborted).toBe(true);
  });

  // Between register and the SDK actually presenting, the backdrop is a
  // normal-looking screen with a primary button. Tapping it would mount the
  // account step underneath a paywall that then presents on top of it.
  it('keeps Continue inert while the paywall is still being presented', async () => {
    mockRegister.mockReturnValue(new Promise<boolean>(() => {}));

    const { getByText } = render(<PaywallStep />);
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    await act(async () => {
      fireEvent.press(getByText('Continue'));
    });

    expect(mockGoNext).not.toHaveBeenCalled();
  });

  it('re-enables Continue once the SDK reports the paywall failed to present', async () => {
    mockRegister.mockReturnValue(new Promise<boolean>(() => {}));
    const { getByText, rerender } = render(<PaywallStep />);
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));

    mockGate = { isConfigured: true, state: { status: 'error' } };
    rerender(<PaywallStep />);
    await act(async () => {
      fireEvent.press(getByText('Continue'));
    });

    expect(mockGoNext).toHaveBeenCalledTimes(1);
  });

  // A cold launch that resumes on this step arrives before the SDK has
  // configured; registering then is answered immediately for a
  // non-transactional placement and would skip the paywall for good.
  it('waits for the SDK to configure before presenting', async () => {
    mockGate = { isConfigured: false, state: { status: 'idle' } };

    const { rerender } = render(<PaywallStep />);
    expect(mockRegister).not.toHaveBeenCalled();

    mockGate = { isConfigured: true, state: { status: 'idle' } };
    rerender(<PaywallStep />);

    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
  });

  it('presents anyway once the readiness grace period elapses', async () => {
    jest.useFakeTimers();
    mockGate = { isConfigured: false, state: { status: 'idle' } };

    render(<PaywallStep />);
    await act(async () => {
      jest.advanceTimersByTime(PAYWALL_READY_GRACE_MS);
    });

    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('advances exactly once when the user also taps continue', async () => {
    let releaseRegister: (value: boolean) => void = () => {};
    mockRegister.mockReturnValue(
      new Promise<boolean>((resolve) => {
        releaseRegister = resolve;
      }),
    );

    mockGate = { isConfigured: true, state: { status: 'error' } };

    const { getByText } = render(<PaywallStep />);
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    await act(async () => {
      fireEvent.press(getByText('Continue'));
    });
    releaseRegister(true);

    await waitFor(() => expect(mockGoNext).toHaveBeenCalled());
    expect(mockGoNext).toHaveBeenCalledTimes(1);
  });

  // Without a session there is no billing identity: a purchase made now could
  // not be attributed to anyone and would simply be lost.
  it('skips the paywall when there is no session to attribute a purchase to', async () => {
    mockAuthState = { user: null };

    render(<PaywallStep />);

    await waitFor(() => expect(mockGoNext).toHaveBeenCalledTimes(1));
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('skips the paywall for a user who is already subscribed', async () => {
    mockUsageState = { usage: SUBSCRIBED, isLoading: false };
    mockLoad.mockResolvedValue({ status: 'skipped', reason: 'fresh', usage: SUBSCRIBED });

    render(<PaywallStep />);

    await waitFor(() => expect(mockGoNext).toHaveBeenCalledTimes(1));
    expect(mockRegister).not.toHaveBeenCalled();
  });

  // Until /api/usage answers, `usage` is null, which used to read as "not
  // subscribed" and showed a paid user the offer on a cold resume.
  describe('waiting for the account plan', () => {
    it('does not present while usage is loading', async () => {
      mockLoad.mockReturnValue(new Promise(() => {}));

      render(<PaywallStep />);
      await act(async () => {});

      expect(mockLoad).toHaveBeenCalledTimes(1);
      expect(mockRegister).not.toHaveBeenCalled();
      expect(mockGoNext).not.toHaveBeenCalled();
    });

    it('skips the paywall when the load reports a subscription', async () => {
      mockLoad.mockResolvedValue({ status: 'loaded', usage: SUBSCRIBED, loadedAt: 1 });

      render(<PaywallStep />);

      await waitFor(() => expect(mockGoNext).toHaveBeenCalledTimes(1));
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('presents the paywall when the load reports a free account', async () => {
      mockLoad.mockResolvedValue({ status: 'loaded', usage: FREE, loadedAt: 1 });

      render(<PaywallStep />);

      await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    });

    it('treats usage that is already fresh as known', async () => {
      mockLoad.mockResolvedValue({ status: 'skipped', reason: 'fresh', usage: FREE });

      render(<PaywallStep />);

      await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    });

    // A free user on a bad network misses the onboarding offer; a paid user
    // is never shown one. Later limit and feature paywalls still reach the
    // free user.
    it('skips the paywall when fresh usage is empty', async () => {
      mockLoad.mockResolvedValue({ status: 'skipped', reason: 'fresh', usage: null });

      render(<PaywallStep />);

      await waitFor(() => expect(mockGoNext).toHaveBeenCalledTimes(1));
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('ignores a plan that arrives for an account the user has since left', async () => {
      let resolveFirstLoad: (value: unknown) => void = () => {};
      mockLoad
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirstLoad = resolve;
          }),
        )
        .mockReturnValueOnce(new Promise(() => {}));

      const { rerender } = render(<PaywallStep />);
      mockAuthState = { user: { id: 'linked-user', isAnonymous: false } };
      rerender(<PaywallStep />);
      await act(async () => {
        resolveFirstLoad({ status: 'loaded', usage: FREE, loadedAt: 1 });
      });

      expect(mockLoad).toHaveBeenCalledTimes(2);
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('skips the paywall when the load fails', async () => {
      mockLoad.mockResolvedValue({ status: 'failed', error: new Error('offline'), usage: null });

      render(<PaywallStep />);

      await waitFor(() => expect(mockGoNext).toHaveBeenCalledTimes(1));
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('skips the paywall when the load hangs past the grace period', async () => {
      jest.useFakeTimers();
      mockLoad.mockReturnValue(new Promise(() => {}));

      render(<PaywallStep />);
      await act(async () => {
        jest.advanceTimersByTime(PAYWALL_READY_GRACE_MS - 1);
      });
      expect(mockGoNext).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(1);
      });

      expect(mockGoNext).toHaveBeenCalledTimes(1);
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('ignores a load that resolves after the grace period skipped the paywall', async () => {
      jest.useFakeTimers();
      let resolveLoad: (value: unknown) => void = () => {};
      mockLoad.mockReturnValue(
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
      );

      render(<PaywallStep />);
      await act(async () => {
        jest.advanceTimersByTime(PAYWALL_READY_GRACE_MS);
      });
      await act(async () => {
        resolveLoad({ status: 'loaded', usage: FREE, loadedAt: 1 });
      });

      expect(mockGoNext).toHaveBeenCalledTimes(1);
      expect(mockRegister).not.toHaveBeenCalled();
    });

    // The entitlement bridge forces its own load at sign-in; a second,
    // unforced load is answered "loading" and has to wait for that one.
    it('waits for a load already in flight, then uses its result', async () => {
      mockUsageState = { usage: null, isLoading: true };
      mockLoad
        .mockResolvedValueOnce({ status: 'skipped', reason: 'loading', usage: null })
        .mockResolvedValueOnce({ status: 'skipped', reason: 'fresh', usage: SUBSCRIBED });

      render(<PaywallStep />);
      await act(async () => {});
      expect(mockLoad).toHaveBeenCalledTimes(1);
      expect(mockGoNext).not.toHaveBeenCalled();

      await act(async () => {
        setMockUsageState({ usage: SUBSCRIBED, isLoading: false });
      });

      await waitFor(() => expect(mockGoNext).toHaveBeenCalledTimes(1));
      expect(mockLoad).toHaveBeenCalledTimes(2);
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('loads again when its load was superseded by a newer one', async () => {
      mockLoad
        .mockResolvedValueOnce({ status: 'stale', usage: null })
        .mockResolvedValueOnce({ status: 'loaded', usage: FREE, loadedAt: 1 });

      render(<PaywallStep />);

      await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
      expect(mockLoad).toHaveBeenCalledTimes(2);
    });

    it('skips the paywall when the store has no session to load usage for', async () => {
      mockLoad.mockResolvedValue({ status: 'skipped', reason: 'unauthenticated', usage: null });

      render(<PaywallStep />);

      await waitFor(() => expect(mockGoNext).toHaveBeenCalledTimes(1));
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('waits for both the plan and the SDK before presenting', async () => {
      mockGate = { isConfigured: false, state: { status: 'idle' } };

      const { rerender } = render(<PaywallStep />);
      await act(async () => {});
      expect(mockLoad).toHaveBeenCalledTimes(1);
      expect(mockRegister).not.toHaveBeenCalled();

      mockGate = { isConfigured: true, state: { status: 'idle' } };
      rerender(<PaywallStep />);

      await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    });

    it('does not load usage when there is no session', async () => {
      mockAuthState = { user: null };

      render(<PaywallStep />);

      await waitFor(() => expect(mockGoNext).toHaveBeenCalledTimes(1));
      expect(mockLoad).not.toHaveBeenCalled();
    });

    it('does not advance when unmounted while usage is loading', async () => {
      let resolveLoad: (value: unknown) => void = () => {};
      mockLoad.mockReturnValue(
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
      );

      const { unmount } = render(<PaywallStep />);
      unmount();
      await act(async () => {
        resolveLoad({ status: 'failed', error: new Error('offline'), usage: null });
      });

      expect(mockGoNext).not.toHaveBeenCalled();
      expect(mockRegister).not.toHaveBeenCalled();
    });
  });

  it('does not advance after unmounting mid-presentation', async () => {
    let releaseRegister: (value: boolean) => void = () => {};
    mockRegister.mockReturnValue(
      new Promise<boolean>((resolve) => {
        releaseRegister = resolve;
      }),
    );

    const { unmount } = render(<PaywallStep />);
    unmount();
    releaseRegister(true);
    await Promise.resolve();

    expect(mockGoNext).not.toHaveBeenCalled();
  });
});

it('allows retrying continuation after a progress save fails', async () => {
  mockGoNext.mockRejectedValueOnce(
    new Error("Calling the 'setValueWithKeyAsync' function has failed"),
  );
  const screen = render(<PaywallStep />);
  expect(await screen.findByText('Could not save progress. Try again.')).toBeTruthy();
  expect(screen.queryByText(/setValueWithKeyAsync/)).toBeNull();
  fireEvent.press(screen.getByText('Continue'));
  await waitFor(() => expect(mockGoNext).toHaveBeenCalledTimes(2));
  expect(mockRegister).toHaveBeenCalledTimes(1);
});
