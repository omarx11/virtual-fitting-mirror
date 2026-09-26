// Technical spike: proves model loading, worker/delegate, and frame timing before the UI exists.

import { MainThreadBackend, type PoseBackend, WorkerBackend } from './tracking/backends';
import { LM, readLandmark } from './tracking/landmarks';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = $('log');
const video = $<HTMLVideoElement>('v');
const canvas = $<HTMLCanvasElement>('c');
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const w = window as unknown as { __spike: Record<string, unknown> };
w.__spike = { status: 'idle' };

$<HTMLInputElement>('file').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const delegate = $<HTMLSelectElement>('delegate').value as 'GPU' | 'CPU';
  const model = $<HTMLSelectElement>('model').value as 'lite' | 'full';
  const kind = $<HTMLSelectElement>('backend').value;
  const req = { model, delegate };
  const backend: PoseBackend = kind === 'worker' ? new WorkerBackend(req) : new MainThreadBackend(req);
  w.__spike.status = 'loading';
  const info = await backend
    .init(() => {})
    .catch((err: Error) => {
      w.__spike = { status: 'error', error: err.message };
      throw err;
    });
  const resets: number[] = [];
  let firstDetectMs = -1;
  {
    const b = await createImageBitmap(new ImageData(64, 64));
    const f0 = performance.now();
    await backend.detect(b, performance.now());
    firstDetectMs = performance.now() - f0;
  }
  const resetMs = 0;
  setTimeout(async () => {
    for (let i = 0; i < 2; i++) {
      while (busy) await new Promise((r) => setTimeout(r, 1));
      busy = true;
      const r0 = performance.now();
      await backend.reset();
      resets.push(performance.now() - r0);
      busy = false;
    }
  }, 4000);
  video.src = URL.createObjectURL(file);
  await video.play();
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const inf: number[] = [];
  const e2e: number[] = [];
  let frames = 0;
  let results = 0;
  let detected = 0;
  let busy = false;
  const t0 = performance.now();
  const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
    frames++;
    ctx.drawImage(video, 0, 0);
    if (!busy) {
      busy = true;
      const long = 512;
      const s = long / Math.max(video.videoWidth, video.videoHeight);
      const captured = performance.now();
      createImageBitmap(video, {
        resizeWidth: Math.round(video.videoWidth * s),
        resizeHeight: Math.round(video.videoHeight * s),
        resizeQuality: 'low',
      })
        .then((bmp) => backend.detect(bmp, captured))
        .then((out) => {
          results++;
          inf.push(out.inferenceMs);
          e2e.push(performance.now() - captured);
          const pose = out.poses[0];
          if (pose) {
            detected++;
            ctx.fillStyle = 'lime';
            for (const i of [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip, LM.nose]) {
              const lm = readLandmark(pose.image, i);
              ctx.fillRect(lm.x * canvas.width - 4, lm.y * canvas.height - 4, 8, 8);
            }
          }
        })
        .finally(() => {
          busy = false;
        });
    }
    void meta;
    if (!video.ended) video.requestVideoFrameCallback(onFrame);
  };
  video.requestVideoFrameCallback(onFrame);
  const report = () => {
    const secs = (performance.now() - t0) / 1000;
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
    const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] ?? 0;
    w.__spike = {
      status: 'running',
      kind,
      info,
      resetMs,
      firstDetectMs: +firstDetectMs.toFixed(1),
      resets: resets.map((x) => +x.toFixed(1)),
      video: `${video.videoWidth}x${video.videoHeight}`,
      secs: +secs.toFixed(1),
      renderFps: +(frames / secs).toFixed(1),
      inferenceFps: +(results / secs).toFixed(1),
      detectedRatio: +(detected / Math.max(1, results)).toFixed(2),
      inferenceMsMedian: +med(inf).toFixed(1),
      inferenceMsP95: +p95(inf).toFixed(1),
      captureToResultMsMedian: +med(e2e).toFixed(1),
      captureToResultMsP95: +p95(e2e).toFixed(1),
    };
    log.textContent = JSON.stringify(w.__spike, null, 1);
  };
  setInterval(report, 500);
});
