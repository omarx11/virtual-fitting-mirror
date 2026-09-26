import { type RefObject, useEffect, useRef, useState } from 'react';
import { type EngineSettings, type EngineSnapshot, MirrorEngine } from './MirrorEngine';

/**
 * Creates one MirrorEngine for the component's lifetime. Safe under React Strict Mode: the dev
 * double-mount creates, disposes (terminating the worker, stopping sources) and recreates it.
 */
export function useMirrorEngine(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  stageRef: RefObject<HTMLElement | null>,
  initialSettings: EngineSettings,
): { engine: MirrorEngine | null; snapshot: EngineSnapshot | null; initError: string | null } {
  const [engine, setEngine] = useState<MirrorEngine | null>(null);
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const settingsRef = useRef(initialSettings);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    let instance: MirrorEngine;
    try {
      instance = new MirrorEngine(canvas, stage, settingsRef.current);
    } catch (error) {
      setInitError(error instanceof Error ? error.message : String(error));
      return;
    }
    setEngine(instance);
    const unsubscribe = instance.subscribe(setSnapshot);
    // Exposed for automated browser tests and manual debugging in DevTools.
    (window as unknown as { __mirror?: MirrorEngine }).__mirror = instance;
    return () => {
      unsubscribe();
      instance.dispose();
      setEngine(null);
      const w = window as unknown as { __mirror?: MirrorEngine };
      if (w.__mirror === instance) delete w.__mirror;
    };
  }, [canvasRef, stageRef]);

  return { engine, snapshot, initError };
}
