import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const FIXTURES = join(process.cwd(), 'tests', 'fixtures');
export const FOOTAGE = join(process.cwd(), 'test-footage');
export const footage = (name: string) => join(FOOTAGE, name);
export const hasFootage = (name: string) => existsSync(footage(name));

/** Shape of the engine snapshot read through the window.__mirror debug hook. */
export interface Snap {
  phase: string;
  tracker: {
    state: string;
    info?: { initMs: number; delegate: string; model: string };
    backend?: string;
    kind?: string;
  };
  source: {
    state: string;
    kind?: string;
    errorKind?: string;
    message?: string;
    width?: number;
    height?: number;
  };
  playback: { paused: boolean; loop: boolean; ended: boolean; duration: number | null };
  diagnostics: {
    opacity: number;
    generation: number;
    scheduler: {
      submitted: number;
      completed: number;
      superseded: number;
      stale: number;
      errors: number;
    } | null;
    canvasSize: { width: number; height: number };
    inferenceFps: number;
  };
}

export async function snap(page: Page): Promise<Snap> {
  return page.evaluate(
    () => (window as unknown as { __mirror: { snapshot(): unknown } }).__mirror.snapshot() as never,
  );
}

export async function currentTime(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __mirror: { currentTime: number } }).__mirror.currentTime,
  );
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

export async function openApp(page: Page, prefs: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((p) => {
    try {
      localStorage.setItem('virtual-fitting-mirror.preferences.v1', JSON.stringify(p));
    } catch {}
  }, prefs);
  await page.goto('/');
  await page.waitForFunction(() => '__mirror' in window);
}

export async function waitForTracker(page: Page, state = 'ready'): Promise<void> {
  await expect.poll(async () => (await snap(page)).tracker.state, { timeout: 30_000 }).toBe(state);
}

export async function openFile(page: Page, path: string): Promise<void> {
  await page.setInputFiles('[data-testid=file-input]', path);
}
