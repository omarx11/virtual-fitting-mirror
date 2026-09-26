#!/usr/bin/env node
// Downloads the openly licensed test clips listed in test-footage/SOURCES.md from Wikimedia
// Commons and (if ffmpeg is on PATH) derives the cropped test variants used in docs/TESTING.md.
// The clips are third-party works: they are NOT committed to the repository.
//
// Usage: npm run fetch:footage

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const UA = 'virtual-fitting-mirror-prototype/0.1 (local test footage download)';

const CLIPS = [
  'Jumping_jacks_and_burpees.webm|5/57',
  'Squat_and_Frontal_Raise.webm|7/7f',
  'Squat_-_exercise_demonstration_video.webm|5/5c',
  'A_woman_on_dancing_floor.webm|d/d2',
].map((line) => {
  const [file, hash] = line.split('|');
  return { file, url: `https://upload.wikimedia.org/wikipedia/commons/${hash}/${file}` };
});

// Digital crops of the full-body clip. They test partial framing / re-entry logic, NOT different
// camera perspectives.
const DERIVED = [
  {
    out: 'derived_upper_landscape.mp4',
    args: [
      '-t',
      '20',
      '-i',
      'Jumping_jacks_and_burpees.webm',
      '-vf',
      'crop=160:120:235:115,scale=640:480:flags=lanczos',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '20',
      '-an',
    ],
  },
  {
    out: 'derived_upper_portrait.webm',
    args: [
      '-t',
      '20',
      '-i',
      'Jumping_jacks_and_burpees.webm',
      '-vf',
      'crop=96:128:267:108,scale=360:480:flags=lanczos',
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      '32',
      '-an',
    ],
  },
  {
    out: 'derived_full_portrait.mp4',
    args: [
      '-t',
      '20',
      '-i',
      'Jumping_jacks_and_burpees.webm',
      '-vf',
      'crop=240:320:195:60,scale=480:640:flags=lanczos',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '20',
      '-an',
    ],
  },
  {
    out: 'derived_leave_reenter.mp4',
    args: [
      '-t',
      '16',
      '-i',
      'Jumping_jacks_and_burpees.webm',
      '-vf',
      "crop=240:320:'if(lt(t,3),400,if(lt(t,8),195,if(lt(t,11),0,195)))':60,scale=480:640:flags=lanczos",
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '20',
      '-an',
    ],
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const clip of CLIPS) {
  const dest = join(dir, clip.file);
  if (existsSync(dest)) {
    console.log(`[footage] ok       ${clip.file}`);
    continue;
  }
  process.stdout.write(`[footage] fetching ${clip.file}… `);
  const res = await fetch(clip.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    console.log(`failed (HTTP ${res.status}); Wikimedia may rate-limit — wait a minute and rerun.`);
    continue;
  }
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log('done');
  await sleep(3000); // be polite to upload.wikimedia.org
}

let ffmpeg = true;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  ffmpeg = false;
  console.log(
    '[footage] ffmpeg not found: skipping derived crops (install with: winget install Gyan.FFmpeg).',
  );
}
if (ffmpeg) {
  for (const d of DERIVED) {
    if (existsSync(join(dir, d.out))) {
      console.log(`[footage] ok       ${d.out}`);
      continue;
    }
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...d.args, d.out], { cwd: dir, stdio: 'inherit' });
    console.log(`[footage] derived  ${d.out}`);
  }
}
