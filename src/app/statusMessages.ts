/**
 * Maps engine state to the shopper-facing status. Messages describe the actual cause: a model
 * failure is never reported as a posture problem, and vice versa.
 */
import type { TrackingPhase } from '../fitting/interpreter';
import { en, type Messages, type StatusTone } from '../i18n/en';
import type { SourceStatus, TrackerStatus } from './MirrorEngine';

export type { StatusTone };

export interface StatusMessage {
  tone: StatusTone;
  title: string;
  detail?: string;
}

export function describeStatus(
  input: {
    tracker: TrackerStatus;
    source: SourceStatus;
    phase: TrackingPhase;
  },
  m: Messages['status'] = en.status,
): StatusMessage | null {
  const { tracker, source, phase } = input;
  // Without a source the empty-state panel explains everything (including tracker errors).
  if (source.state === 'none' || source.state === 'error') return null;
  if (tracker.state === 'error') {
    return {
      tone: 'error',
      title: m.trackingUnavailable,
      detail: m.trackerError(tracker.kind, tracker.message),
    };
  }
  if (source.state === 'loading') {
    return { tone: 'info', title: source.kind === 'camera' ? m.startingCamera : m.openingVideo };
  }
  if (tracker.state === 'loading' || tracker.state === 'idle') {
    const percent =
      tracker.state === 'loading' && tracker.progress !== null ? Math.round(tracker.progress * 100) : null;
    return {
      tone: 'info',
      title: m.loadingTracking(percent),
      detail: tracker.state === 'loading' ? m.loadingSteps[tracker.step] : '',
    };
  }
  return m.phases[phase];
}
