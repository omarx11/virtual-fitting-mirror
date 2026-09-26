// Runs with Chromium's --use-fake-device-for-media-stream: a SYNTHETIC camera. It verifies the
// camera code path (permission request, no audio, track cleanup) — not a physical webcam.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES, openApp, openFile, snap } from './helpers';

test('camera mode starts on request only, never asks for audio, and stops tracks on switch', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __gum: { constraints: MediaStreamConstraints[]; tracks: MediaStreamTrack[] };
    };
    w.__gum = { constraints: [], tracks: [] };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      w.__gum.constraints.push(c ?? {});
      const stream = await original(c);
      w.__gum.tracks.push(...stream.getTracks());
      return stream;
    };
  });
  await openApp(page);
  // Nothing requested before the user chooses camera mode.
  expect(
    await page.evaluate(
      () => (window as unknown as { __gum: { constraints: unknown[] } }).__gum.constraints.length,
    ),
  ).toBe(0);

  await page.getByRole('button', { name: 'Use camera' }).click();
  await expect.poll(async () => (await snap(page)).source.state).toBe('ready');
  expect((await snap(page)).source.kind).toBe('camera');
  const info = await page.evaluate(() => {
    const g = (
      window as unknown as { __gum: { constraints: MediaStreamConstraints[]; tracks: MediaStreamTrack[] } }
    ).__gum;
    return { audio: g.constraints.map((c) => c.audio ?? false), kinds: g.tracks.map((t) => t.kind) };
  });
  expect(info.audio.every((a) => a === false)).toBe(true);
  expect(info.kinds).not.toContain('audio');

  // Switching to a file stops every camera track.
  await openFile(page, join(FIXTURES, 'synthetic-pattern.webm'));
  await expect.poll(async () => (await snap(page)).source.kind).toBe('file');
  const states = await page.evaluate(() =>
    (window as unknown as { __gum: { tracks: MediaStreamTrack[] } }).__gum.tracks.map((t) => t.readyState),
  );
  expect(states.every((s) => s === 'ended')).toBe(true);
});
