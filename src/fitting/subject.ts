/**
 * Keeps one stable subject when the model returns several poses. No face recognition: only the
 * position and size of the previously tracked torso are used.
 */
import type { Point } from '../rendering/matrix';
import { type PoseObservation, subjectAnchor } from './observation';

export interface SubjectMemory {
  center: Point;
  width: number;
  timeMs: number;
}

export interface SubjectSelectionConfig {
  /** How long the previous subject's location is remembered (ms of frame time). */
  memoryMs: number;
  /** A candidate further than this many shoulder widths from the remembered subject is someone else. */
  maxJumpWidths: number;
}

export const DEFAULT_SUBJECT_CONFIG: SubjectSelectionConfig = { memoryMs: 1500, maxJumpWidths: 2 };

/**
 * Returns the index of the observation to track, or null when the remembered subject is not
 * visible (we prefer a brief fade-out over jumping to a different person).
 */
export function selectSubject(
  observations: readonly PoseObservation[],
  memory: SubjectMemory | null,
  nowMs: number,
  config: SubjectSelectionConfig = DEFAULT_SUBJECT_CONFIG,
): number | null {
  const anchors = observations.map((o) => subjectAnchor(o));
  const valid = anchors
    .map((a, index) => (a ? { ...a, index } : null))
    .filter((a): a is NonNullable<typeof a> => a !== null);
  if (valid.length === 0) return null;

  const memoryActive = memory !== null && nowMs - memory.timeMs <= config.memoryMs && nowMs >= memory.timeMs;
  if (memoryActive && memory) {
    let best: { index: number; d: number } | null = null;
    for (const a of valid) {
      const d = Math.hypot(a.center.x - memory.center.x, a.center.y - memory.center.y) / memory.width;
      if (!best || d < best.d) best = { index: a.index, d };
    }
    return best && best.d <= config.maxJumpWidths ? best.index : null;
  }

  // No recent subject: choose the largest, most central person.
  let best: { index: number; score: number } | null = null;
  for (const a of valid) {
    const frameWidth = observations[a.index]?.width ?? 1;
    const offCentre = Math.abs(a.center.x / frameWidth - 0.5);
    const score = a.width * (1 - offCentre);
    if (!best || score > best.score) best = { index: a.index, score };
  }
  return best ? best.index : null;
}
