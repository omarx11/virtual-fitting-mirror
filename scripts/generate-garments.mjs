#!/usr/bin/env node
// Generates the original DEMO garment artwork (SVG) in public/garments/.
// All shapes are drawn here from shared geometry so the anchors in src/garments/catalogue.ts
// stay exact. Output is original work for this project (see public/garments/LICENSE.md).
//
// Geometry (body image 600 × 720, front view, wearer's LEFT on the image RIGHT):
//   wearer's right shoulder seam (175,120) · wearer's left shoulder seam (425,120)
//   neck centre (300,95) · hem centre (300,680)
// Sleeve images are 200 × 170 with the pivot at (100,22) and the sleeve axis pointing down (+y).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'garments');

const BODY_W = 600;
const BODY_H = 720;
const SLEEVE_W = 200;
const SLEEVE_H = 170;

/** Torso outline without sleeves. The shoulder caps extend a little past the seam to hide the joint. */
function torsoPath(neck) {
  const neckTop = 92;
  const neckHalf = neck === 'boat' ? 78 : neck === 'collar' ? 50 : 56;
  const dip = neck === 'v' ? 205 : neck === 'boat' ? 118 : neck === 'collar' ? 112 : 142;
  return [
    `M ${300 - neckHalf} ${neckTop}`,
    // front neckline
    neck === 'v'
      ? `L 300 ${dip} L ${300 + neckHalf} ${neckTop}`
      : `Q 300 ${dip + (dip - neckTop) * 0.35} ${300 + neckHalf} ${neckTop}`,
    // wearer's left shoulder line to the seam and around the cap
    `L 425 118 Q 446 124 448 150`,
    // armhole down to the underarm
    `Q 440 205 434 252`,
    // side seam with a slight waist taper
    `Q 424 380 419 470 Q 417 580 421 668`,
    // hem
    `Q 300 686 179 668`,
    // wearer's right side back up
    `Q 183 580 181 470 Q 176 380 166 252`,
    `Q 160 205 152 150 Q 154 124 175 118 Z`,
  ].join(' ');
}

/** Sleeve outline: ~88 px wide at the cap, ~76 px at the opening (≈0.42 × shoulder width once fitted). */
function sleevePath(length) {
  const bottom = 22 + length;
  return `M 54 32 Q 100 2 146 32 L 139 ${bottom - 5} Q 100 ${bottom + 7} 61 ${bottom - 5} Z`;
}

function shading(id, base, dark, light) {
  return `
    <linearGradient id="${id}-side" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${dark}"/>
      <stop offset="0.22" stop-color="${base}"/>
      <stop offset="0.5" stop-color="${light}"/>
      <stop offset="0.78" stop-color="${base}"/>
      <stop offset="1" stop-color="${dark}"/>
    </linearGradient>
    <linearGradient id="${id}-drop" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.85" stop-color="#000" stop-opacity="0.04"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.16"/>
    </linearGradient>`;
}

const FOLDS = `
  <g fill="none" stroke="#000" stroke-linecap="round" opacity="0.10" stroke-width="5">
    <path d="M 200 300 Q 215 420 205 560"/>
    <path d="M 405 320 Q 392 430 400 580"/>
    <path d="M 250 560 Q 300 585 350 562"/>
  </g>
  <g fill="none" stroke="#fff" stroke-linecap="round" opacity="0.10" stroke-width="4">
    <path d="M 300 240 Q 305 400 296 620"/>
  </g>`;

const GARMENTS = [
  {
    id: 'coral-crew-tee',
    title: 'Coral crew tee',
    neck: 'crew',
    colors: { base: '#e8735f', dark: '#b8503f', light: '#f28e7b', trim: '#c95a48' },
    sleeveLength: 104,
    extras: () => '',
  },
  {
    id: 'breton-stripe-tee',
    title: 'Breton stripe',
    neck: 'boat',
    colors: { base: '#f4f1e8', dark: '#cfcabb', light: '#ffffff', trim: '#1f2e5a' },
    sleeveLength: 118,
    pattern: (clip) => `
      <pattern id="stripes" width="600" height="44" patternUnits="userSpaceOnUse">
        <rect y="22" width="600" height="16" fill="#1f2e5a"/>
      </pattern>
      <rect x="0" y="175" width="600" height="545" fill="url(#stripes)" clip-path="url(#${clip})" opacity="0.92"/>`,
    sleevePattern: (clip) => `
      <pattern id="sstripes" width="200" height="44" patternUnits="userSpaceOnUse">
        <rect y="22" width="200" height="16" fill="#1f2e5a"/>
      </pattern>
      <rect x="0" y="40" width="200" height="130" fill="url(#sstripes)" clip-path="url(#${clip})" opacity="0.92"/>`,
    extras: () => '',
  },
  {
    id: 'chambray-button-shirt',
    title: 'Chambray shirt',
    neck: 'collar',
    colors: { base: '#6f95c2', dark: '#4d6f99', light: '#8fb0d6', trim: '#56779f' },
    sleeveLength: 100,
    extras: (c) => `
      <path d="M 250 92 L 300 150 L 262 176 L 228 104 Z" fill="${c.light}" stroke="${c.trim}" stroke-width="3"/>
      <path d="M 350 92 L 300 150 L 338 176 L 372 104 Z" fill="${c.light}" stroke="${c.trim}" stroke-width="3"/>
      <rect x="289" y="150" width="22" height="528" fill="${c.base}" stroke="${c.trim}" stroke-width="2.5"/>
      ${[200, 290, 380, 470, 560, 640].map((y) => `<circle cx="300" cy="${y}" r="6.5" fill="#f5f2ea" stroke="#9aa3ad" stroke-width="1.5"/>`).join('')}
      <path d="M 355 250 L 405 250 L 405 305 Q 380 318 355 305 Z" fill="none" stroke="${c.trim}" stroke-width="3"/>
      <line x1="355" y1="262" x2="405" y2="262" stroke="${c.trim}" stroke-width="2.5"/>`,
  },
  {
    id: 'forest-v-neck',
    title: 'Forest V-neck',
    neck: 'v',
    colors: { base: '#3f6b4f', dark: '#2a4a36', light: '#548866', trim: '#2f5540' },
    sleeveLength: 102,
    extras: () => '',
  },
];

function neckTrim(neck, color) {
  if (neck === 'collar') return '';
  const d =
    neck === 'v'
      ? 'M 244 92 L 300 205 L 356 92'
      : neck === 'boat'
        ? 'M 222 92 Q 300 127 378 92'
        : 'M 244 92 Q 300 160 356 92';
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function bodySvg(g) {
  const c = g.colors;
  const clip = `${g.id}-clip`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Original demo artwork for virtual-fitting-mirror (CC0-1.0). Anchors: see src/garments/catalogue.ts -->
<svg xmlns="http://www.w3.org/2000/svg" width="${BODY_W}" height="${BODY_H}" viewBox="0 0 ${BODY_W} ${BODY_H}" role="img">
  <title>${g.title} (demo garment body)</title>
  <defs>
    ${shading(g.id, c.base, c.dark, c.light)}
    <clipPath id="${clip}"><path d="${torsoPath(g.neck)}"/></clipPath>
  </defs>
  <path d="${torsoPath(g.neck)}" fill="url(#${g.id}-side)"/>
  ${g.pattern ? g.pattern(clip) : ''}
  <g clip-path="url(#${clip})">
    ${FOLDS}
    <rect width="600" height="720" fill="url(#${g.id}-drop)"/>
    <path d="M 175 660 Q 300 680 425 660" fill="none" stroke="${c.dark}" stroke-width="6" opacity="0.6"/>
  </g>
  ${neckTrim(g.neck, c.trim)}
  ${g.extras(c)}
  <path d="${torsoPath(g.neck)}" fill="none" stroke="${c.dark}" stroke-width="2" opacity="0.5"/>
</svg>
`;
}

function sleeveSvg(g, side) {
  const c = g.colors;
  const clip = `${g.id}-${side}-sclip`;
  const d = sleevePath(g.sleeveLength);
  // The right sleeve is the mirror image of the left one.
  const flip = side === 'right' ? ` transform="translate(${SLEEVE_W} 0) scale(-1 1)"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Original demo artwork for virtual-fitting-mirror (CC0-1.0). Pivot (100,22), axis +y. -->
<svg xmlns="http://www.w3.org/2000/svg" width="${SLEEVE_W}" height="${SLEEVE_H}" viewBox="0 0 ${SLEEVE_W} ${SLEEVE_H}" role="img">
  <title>${g.title} (demo ${side} sleeve)</title>
  <defs>
    <linearGradient id="${g.id}-${side}-sg" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${c.light}"/>
      <stop offset="0.55" stop-color="${c.base}"/>
      <stop offset="1" stop-color="${c.dark}"/>
    </linearGradient>
    <clipPath id="${clip}"><path d="${d}"/></clipPath>
  </defs>
  <g${flip}>
    <path d="${d}" fill="url(#${g.id}-${side}-sg)"/>
    ${g.sleevePattern ? g.sleevePattern(clip) : ''}
    <path d="M 62 ${22 + g.sleeveLength - 12} Q 100 ${22 + g.sleeveLength} 138 ${22 + g.sleeveLength - 12}" fill="none" stroke="${c.trim}" stroke-width="6" opacity="0.8"/>
    <path d="${d}" fill="none" stroke="${c.dark}" stroke-width="2" opacity="0.5"/>
  </g>
</svg>
`;
}

/** Catalogue thumbnail: body plus both sleeves at rest, inlined (an <img> SVG cannot load sub-images). */
function previewSvg(g) {
  const rest = 22; // degrees outward
  const inner = (svg) => svg.replace(/<\?xml[^>]*>\s*/, '').replace(/<!--[\s\S]*?-->\s*/, '');
  const place = (side) => {
    const [x, y, sign] = side === 'left' ? [425, 120, -1] : [175, 120, 1];
    return `<g transform="translate(${x} ${y}) rotate(${sign * rest}) translate(-100 -22)">${inner(sleeveSvg(g, side))}</g>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="-30 40 660 660" preserveAspectRatio="xMidYMid meet" role="img">
  <title>${g.title}</title>
  ${place('left')}
  ${place('right')}
  ${inner(bodySvg(g))}
</svg>
`;
}

for (const g of GARMENTS) {
  const dir = join(outRoot, g.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'body.svg'), bodySvg(g));
  writeFileSync(join(dir, 'sleeve-left.svg'), sleeveSvg(g, 'left'));
  writeFileSync(join(dir, 'sleeve-right.svg'), sleeveSvg(g, 'right'));
  writeFileSync(join(dir, 'preview.svg'), previewSvg(g));
  console.log(`[garments] wrote ${g.id}`);
}
