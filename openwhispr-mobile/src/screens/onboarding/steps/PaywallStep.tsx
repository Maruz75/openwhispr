import { useOnboardingStep } from '@/hooks/useOnboardingStep';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';
import { SystemIcon, type LucideIconName } from '@/components/ui/SystemIcon';
import { useAuthStore } from '@/store/useAuthStore';
import { useUsageStore } from '@/store/useUsageStore';
import { useSuperwallGate } from '@/hooks/useSuperwallGate';
import { SUPERWALL_PLACEMENTS } from '@/lib/superwall';
import { describeOnboardingError } from '@/lib/onboardingErrors';

const HIGHLIGHTS: { icon: string; mdIcon: LucideIconName; label: string }[] = [
  { icon: 'cloud', mdIcon: 'Cloud', label: 'Cloud transcription with no word limit' },
  { icon: 'arrow.triangle.2.circlepath', mdIcon: 'RefreshCw', label: 'Sync notes across devices' },
  { icon: 'sparkles', mdIcon: 'Sparkles', label: 'AI cleanup, actions, and note chat' },
];

// A cold launch that resumes on this step arrives before the SDK's configure
// round trip has finished; registering then is answered immediately for a
// non-transactional placement and would skip the paywall for good. Wait this
// long for it, then present anyway so a broken SDK cannot hold the step. The
// account's plan gets the same window, but an unknown plan skips instead: a
// paid user must never see the offer, and a free one still meets the usage
// limit and feature paywalls later.
export const PAYWALL_READY_GRACE_MS = 3_000;
// How long Continue stays inert after registering: long enough for the SDK to
// actually present (or report it can't), short enough that a paywall which
// never resolves is still escapable.
export const PAYWALL_ESCAPE_MS = 8_000;

// `skip` covers both a subscriber and an account whose plan can't be confirmed.
type AccountPlan = 'checking' | 'free' | 'skip';

function untilUsageIdle(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || !useUsageStore.getState().isLoading) {
      resolve();
      return;
    }
    const finish = (): void => {
      unsubscribe();
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const unsubscribe = useUsageStore.subscribe((state) => {
      if (!state.isLoading) finish();
    });
    signal.addEventListener('abort', finish);
  });
}

// Trusts `load()`'s answer rather than the store snapshot: it drops usage that
// belongs to another owner and only reports `fresh` for the current one.
async function loadAccountPlan(signal: AbortSignal): Promise<AccountPlan> {
  while (!signal.aborted) {
    const result = await useUsageStore.getState().load();
    if (result.status === 'loaded' || (result.status === 'skipped' && result.reason === 'fresh')) {
      if (!result.usage) return 'skip';
      return result.usage.isSubscribed ? 'skip' : 'free';
    }
    // Another caller's load (the entitlement bridge forces one at sign-in) is
    // in flight or superseded this one; its result lands in the store, so ask
    // again once it settles. The grace period bounds the wait.
    if (result.status === 'skipped' && result.reason === 'loading') {
      await untilUsageIdle(signal);
      continue;
    }
    if (result.status === 'stale') continue;
    return 'skip';
  }
  return 'skip';
}

/**
 * Presents the Superwall paywall, then resumes setup whether or
 * not anything was purchased. This screen is only a backdrop — Superwall's own
 * paywall is the real surface — so its job is to never become a dead end.
 */
export function PaywallStep() {
  const { goNext } = useOnboardingStep('paywall');
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ?? null;
  const isSubscribed = useUsageStore((s) => s.usage?.isSubscribed ?? false);
  const { register, state, isConfigured } = useSuperwallGate();
  const hasPresentedRef = useRef(false);
  const hasAdvancedRef = useRef(false);
  const unmountedRef = useRef(false);
  const registrationRef = useRef<AbortController | null>(null);
  const [graceElapsed, setGraceElapsed] = useState(false);
  const [plan, setPlan] = useState<AccountPlan>('checking');
  const [presenting, setPresenting] = useState(false);
  const [escapeElapsed, setEscapeElapsed] = useState(false);

  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const advance = useCallback(async (): Promise<void> => {
    if (hasAdvancedRef.current) return;
    hasAdvancedRef.current = true;
    hasPresentedRef.current = true;
    registrationRef.current?.abort();
    setAdvanceError(null);
    try {
      await goNext();
    } catch (error) {
      hasAdvancedRef.current = false;
      setAdvanceError(describeOnboardingError(error, 'Could not save progress. Try again.'));
    }
  }, [goNext]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      registrationRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setGraceElapsed(true), PAYWALL_READY_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    setPlan('checking');
    loadAccountPlan(controller.signal).then((next) => {
      if (!controller.signal.aborted) setPlan(next);
    });
    return () => controller.abort();
  }, [userId]);

  useEffect(() => {
    if (!presenting) return;
    const timer = setTimeout(() => setEscapeElapsed(true), PAYWALL_ESCAPE_MS);
    return () => clearTimeout(timer);
  }, [presenting]);

  useEffect(() => {
    // Once presented, stay presented: `register` is rebuilt whenever the gate
    // provider's inputs change, and a second registration mid-presentation is
    // answered immediately for a non-transactional placement.
    if (hasPresentedRef.current) return;

    // No session means no billing identity, so a purchase made now could not
    // be attributed to anyone and would be lost; a subscriber has nothing to
    // buy. Until usage answers, a paid account is indistinguishable from a
    // free one, and showing it the offer is worse than a free user missing it.
    const planUnconfirmed = plan === 'skip' || (plan === 'checking' && graceElapsed);
    if (!user || isSubscribed || planUnconfirmed) {
      hasPresentedRef.current = true;
      void advance();
      return;
    }

    if (plan === 'checking') return;
    if (!isConfigured && !graceElapsed) return;
    hasPresentedRef.current = true;
    setPresenting(true);

    // Failures are already reported by SuperwallGateProvider. Swallowing here is
    // what keeps a missing campaign, a bad API key or an SDK error from stopping
    // onboarding — the user just continues setup. Unmount is the
    // only thing that cancels the advance; effect re-runs must not.
    const controller = new AbortController();
    registrationRef.current = controller;
    register({ placement: SUPERWALL_PLACEMENTS.onboardingPaywall, signal: controller.signal })
      .catch(() => {})
      .finally(() => {
        if (!unmountedRef.current) void advance();
      });
  }, [advance, graceElapsed, isConfigured, isSubscribed, plan, register, user]);

  // Between registering and the SDK presenting, this backdrop looks like an
  // ordinary screen with a primary button; tapping it would mount the next
  // step underneath a paywall that then presents on top of it.
  const ctaDisabled = !advanceError && presenting && state.status === 'idle' && !escapeElapsed;

  return (
    <OnboardingShell
      title="Go further with OpenWhispr Pro."
      titleAccent="Pro"
      subtitle="Unlock more with Pro, or close the offer to keep using Cloud with your current limits."
      ctaLabel="Continue"
      ctaDisabled={ctaDisabled}
      onCta={advance}
    >
      <View className="gap-4 pt-2">
        {advanceError ? (
          <Text accessibilityRole="alert" className="text-systemRed">
            {advanceError}
          </Text>
        ) : null}
        {HIGHLIGHTS.map((item) => (
          <View key={item.label} className="flex-row items-center gap-3">
            <SystemIcon name={item.icon} mdName={item.mdIcon} size={20} />
            <Text className="flex-1 text-[16px] text-label">{item.label}</Text>
          </View>
        ))}
      </View>
    </OnboardingShell>
  );
}
