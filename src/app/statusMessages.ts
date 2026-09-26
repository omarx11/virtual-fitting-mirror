/**
 * Maps engine state to the shopper-facing status. Messages describe the actual cause: a model
 * failure is never reported as a posture problem, and vice versa.
 */
import type { TrackingPhase } from '../fitting/interpreter';
import type { SourceStatus, TrackerStatus } from './MirrorEngine';

export type StatusTone = 'ok' | 'info' | 'warn' | 'error';

export interface StatusMessage {
  tone: StatusTone;
  title: string;
  detail?: string;
}

export const PHASE_MESSAGES: Record<TrackingPhase, StatusMessage> = {
  full: { tone: 'ok', title: 'Tracking' },
  upper: { tone: 'ok', title: 'Upper-body view' },
  holding: { tone: 'ok', title: 'Tracking' },
  'too-close': {
    tone: 'warn',
    title: 'Move back slightly',
    detail: 'Keep your head and both shoulders in view.',
  },
  turned: {
    tone: 'warn',
    title: 'Face the mirror',
    detail: 'Stand upright facing the camera — the 2D shirt only follows a front view.',
  },
  searching: {
    tone: 'info',
    title: 'Step into view',
    detail: 'Face the camera with your head and both shoulders visible.',
  },
  lost: { tone: 'warn', title: 'Tracking lost', detail: 'Step back into view, facing the camera.' },
};

export function describeStatus(input: {
  tracker: TrackerStatus;
  source: SourceStatus;
  phase: TrackingPhase;
}): StatusMessage | null {
  const { tracker, source, phase } = input;
  // Without a source the empty-state panel explains everything (including tracker errors).
  if (source.state === 'none' || source.state === 'error') return null;
  if (tracker.state === 'error') {
    return { tone: 'error', title: 'Tracking unavailable', detail: tracker.message };
  }
  if (source.state === 'loading') {
    return { tone: 'info', title: source.kind === 'camera' ? 'Starting camera…' : 'Opening video…' };
  }
  if (tracker.state === 'loading' || tracker.state === 'idle') {
    const pct =
      tracker.state === 'loading' && tracker.progress !== null
        ? ` ${Math.round(tracker.progress * 100)}%`
        : '';
    return {
      tone: 'info',
      title: `Loading tracking…${pct}`,
      detail: tracker.state === 'loading' ? tracker.message : '',
    };
  }
  return PHASE_MESSAGES[phase];
}
