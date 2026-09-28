/**
 * English UI text, and the shape every other language must match (`Messages`).
 *
 * Messages that wrap an engine, browser or server error receive the original English text as well as
 * its code: English shows that detailed text unchanged (it names files, codecs and settings), other
 * languages map the code to their own sentence.
 *
 * Inline `code` in backticks is rendered as <code> by `withCode` (src/i18n/format.tsx).
 */
import type { AiUnavailableCause } from '../ai/controller';
import type { AiErrorCode } from '../ai/types';
import type { TrackerLoadingStep } from '../app/MirrorEngine';
import type { TrackingPhase } from '../fitting/interpreter';
import type { SourceErrorKind } from '../media/frameSource';
import type { InitErrorKind } from '../tracking/protocol';

/** A heading with one highlighted (gradient) part: `pre` + <accent> + `post`. */
export interface AccentText {
  pre: string;
  accent: string;
  post: string;
}

export type StatusTone = 'ok' | 'info' | 'warn' | 'error';
export type ShortcutId =
  | 'play'
  | 'shirtStep'
  | 'shirtToggle'
  | 'mirror'
  | 'fullscreen'
  | 'sidebar'
  | 'diagnostics'
  | 'language'
  | 'help'
  | 'close';

const RENDER_NOTE =
  'Synthetic render of the rigged 3D V-neck model (no fabric texture) — demo only, not a shop photo.';
const PRODUCT_NOTE = 'Product photo supplied by the project owner — a real garment, not a product sold here.';

export const en = {
  meta: {
    title: 'Virtual Fitting Mirror',
    description:
      'Virtual fitting mirror: live 2D/3D try-on and an optional AI photo preview. A Qassim University graduation project by Lamya.',
  },
  brand: {
    name: { pre: 'Fitting ', accent: 'Mirror', post: '' } as AccentText,
    fullName: { pre: 'Virtual ', accent: 'Fitting Mirror', post: '' } as AccentText,
    tagline: 'Virtual try-on',
    builder: 'Lamya',
    university: 'Qassim University',
    projectKind: 'Graduation project',
    by: (builder: string) => `by ${builder}`,
    designedBy: 'Designed & built by',
    kindBy: (kind: string, builder: string, university: string) => `${kind} by ${builder} · ${university}`,
  },
  language: {
    /** The other language's name, written in that language (the switch's visible text). */
    switchText: 'عربي',
    switchTextLang: 'ar',
    switchLabel: 'Switch to Arabic',
    /** Toast after switching to this language. */
    switched: 'English',
  },
  keys: { Space: 'Space', Esc: 'Esc' } as Record<string, string>,
  common: {
    retry: 'Retry',
    close: 'Close dialog',
    endSession: 'End session',
    keyboardShortcuts: 'Keyboard shortcuts',
    about: 'About this project',
    aboutWith: (university: string) => `About this project — ${university}`,
  },
  app: {
    mirrorView: 'Mirror view',
    controls: 'Controls',
    cannotStart: 'Cannot start',
    noFrame: 'No video frame is available yet. Start the camera or open a video, then try again.',
    mirrorOn: 'Mirror on',
    mirrorOff: 'Mirror off',
    shirtShown: 'Shirt shown',
    shirtHidden: 'Shirt hidden',
    sidebarUnfolded: 'Sidebar unfolded',
    sidebarFolded: 'Sidebar folded',
    foldControls: 'Fold controls',
    foldSidebar: 'Fold sidebar',
    showAllControls: 'Show all controls',
    unfoldSidebar: 'Unfold sidebar',
    fullscreenView: 'Fullscreen view',
    sections: {
      source: 'Source',
      ai: 'AI photo preview',
      shirts: 'Shirts',
      fit: 'Adjust fit',
      view: 'View',
    },
    live: 'Live',
    video: 'Video',
    privacyAi: 'Your photo is uploaded only after you agree.',
    privacyLive: 'Your video stays on this device.',
    learnMore: 'Learn more',
  },
  modes: {
    label: 'Try-on mode',
    hints: {
      '2d': 'Live · flat demo shirts',
      '3d': 'Live · rigged 3D shirt',
      ai: 'Generated photo (cloud)',
    },
  },
  about: {
    modes: [
      { title: '2D live', text: 'Flat demo shirts follow your shoulders in real time.' },
      {
        title: '3D live',
        text: 'A rigged 3D shirt moves with your tracked skeleton, with optional fabric motion.',
      },
      {
        title: 'AI photo',
        text: 'Take one photo and a cloud AI generates a still preview — only after you agree.',
      },
    ],
    privacy:
      '2D and 3D run entirely on this device — video is never uploaded. Only AI mode sends one photo to the cloud, and only after you agree.',
    builtWith: 'Built with',
    research: 'Research, testing & limits',
  },
  shortcuts: {
    hint: 'Shortcuts are ignored while you type in a field.',
    actions: {
      play: 'Play / pause the video',
      shirtStep: 'Previous / next shirt',
      shirtToggle: 'Show or hide the shirt',
      mirror: 'Mirror the view',
      fullscreen: 'Fullscreen',
      sidebar: 'Fold or unfold the sidebar',
      diagnostics: 'Diagnostics',
      language: 'Switch language (English / العربية)',
      help: 'This list of shortcuts',
      close: 'Close a dialog',
    } satisfies Record<ShortcutId, string>,
  },
  welcome: {
    title: { pre: 'Virtual ', accent: 'fitting mirror', post: '' } as AccentText,
    lead: 'Try on shirts live in 2D or 3D, or create an AI photo preview.',
    research: 'How it works: research & testing',
    steps: [
      { title: 'Pick a source', text: 'Webcam or video' },
      { title: 'Face the camera', text: 'Shoulders in view' },
      { title: 'Try on shirts', text: 'Switch styles live' },
    ],
    trackerFailed: 'Tracking could not start:',
  },
  status: {
    phases: {
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
        detail: 'Stand upright facing the camera — side and back views are not supported.',
      },
      searching: {
        tone: 'info',
        title: 'Step into view',
        detail: 'Face the camera with your head and both shoulders visible.',
      },
      lost: { tone: 'warn', title: 'Tracking lost', detail: 'Step back into view, facing the camera.' },
    } as Record<TrackingPhase, { tone: StatusTone; title: string; detail?: string }>,
    trackingUnavailable: 'Tracking unavailable',
    startingCamera: 'Starting camera…',
    openingVideo: 'Opening video…',
    loadingTracking: (percent: number | null) =>
      percent === null ? 'Loading tracking…' : `Loading tracking… ${percent}%`,
    loadingSteps: {
      model: 'Loading tracking model…',
      download: 'Downloading tracking model…',
      runtime: 'Starting tracking runtime…',
      prepare: 'Preparing tracker…',
    } satisfies Record<TrackerLoadingStep, string>,
    trackerError: (_kind: InitErrorKind, message: string) => message,
  },
  source: {
    openVideo: 'Open video',
    openVideoFile: 'Open a video file',
    useCamera: 'Use camera',
    restartCamera: 'Restart camera',
    camera: 'Camera',
    defaultCamera: 'Default',
    live: 'Live:',
    playing: 'Playing:',
    error: (_kind: SourceErrorKind, message: string) => message,
  },
  transport: {
    play: 'Play',
    pause: 'Pause',
    restart: 'Restart',
    loop: 'Loop',
    loopOn: 'Loop on',
    loopOff: 'Loop off',
    speed: 'Playback speed',
    seek: 'Seek',
  },
  fit: {
    size: 'Size',
    height: 'Height',
    percent: (n: number) => `${n} percent`,
    default: 'default',
    higher: 'higher',
    lower: 'lower',
    reset: 'Reset fit',
  },
  view: {
    shirt: 'Shirt',
    mirror: 'Mirror',
    armsInFront: 'Arms in front (beta)',
    fabricMotion: 'Fabric motion (beta)',
    fullscreen: 'Fullscreen',
    framing: 'Framing',
    contain: 'Show whole video',
    cover: 'Fill screen (crop)',
  },
  garments: {
    fabricColour: 'Fabric colour',
    shirtColour: 'Shirt colour',
    loading3d: 'Loading 3D shirt…',
    unavailable3d: (message: string) => `3D shirt unavailable: ${message}`,
    unavailable3dFallback: (message: string) =>
      `3D unavailable (${message}). Showing a flat 2D fallback image — not 3D.`,
    imageError: (message: string) => message,
    /** Catalogue text by garment (or picker card) ID. Unknown IDs fall back to the catalogue's own. */
    items: {
      'vneck-3d': { name: 'V-neck (3D)', description: 'V-neck shirt with rolled sleeves — rigged 3D model' },
      'vneck-women-3d': {
        name: 'V-neck women (3D)',
        description: 'Women’s V-neck with rolled sleeves — rigged 3D model',
      },
      'shirt-2d': {
        name: 'Shirt (2D)',
        description: 'Flat demo artwork in several colours (legacy 2D comparison)',
      },
      'coral-crew-tee': { name: 'Coral crew tee', description: 'Solid crew-neck T-shirt', swatch: 'Coral' },
      'breton-stripe-tee': {
        name: 'Breton stripe',
        description: 'Striped boat-neck top',
        swatch: 'Breton stripe',
      },
      'chambray-button-shirt': {
        name: 'Chambray shirt',
        description: 'Short-sleeve button-up with collar',
        swatch: 'Chambray',
      },
      'forest-v-neck': { name: 'Forest V-neck', description: 'V-neck T-shirt', swatch: 'Forest' },
    } as Record<string, { name: string; description: string; swatch?: string }>,
    materials: { stone: 'Stone', navy: 'Navy', olive: 'Olive', white: 'White' } as Record<string, string>,
  },
  ai: {
    panelLead: 'Take a photo, pick a garment, and get an AI preview.',
    unavailableTitle: 'AI preview is unavailable.',
    accessTitle: 'Access code',
    accessHint: 'Enter the code you were given to use AI previews.',
    accessPlaceholder: 'Access code',
    accessUnlock: 'Unlock',
    accessUnlocking: 'Checking…',
    accessGranted: 'Access code accepted on this browser.',
    accessFirst: 'Enter the access code in the panel first',
    keyFirst: 'Add your FASHN API key in the panel first',
    key: {
      title: 'Your FASHN API key',
      optional: 'Use your own FASHN API key',
      hint: 'Saved only in this browser.',
      getKey: 'Get a key',
      placeholder: 'API key',
      save: 'Save',
      checking: 'Checking…',
      saved: 'Using your API key',
      credits: (n: number) => `${n} credits left`,
      remove: 'Remove',
    },
    unavailableReason: (reason: string, _cause: AiUnavailableCause) => reason,
    setup: 'Setup (staff)',
    setupSteps: [
      'Copy `.env.example` to `.env` in the project folder.',
      'On this computer, set `AI_ENABLED=true`, and `FASHN_API_KEY` to your FASHN API key (or leave it empty: visitors then add their own key in this panel). Never put the key in a `VITE_` variable.',
      'Restart with `npm run dev` (or `npm run build` then `npm start`).',
    ],
    setupKeepsWorking: '2D and 3D keep working without it.',
    garmentPhoto: 'Garment photo',
    garmentGroup: 'AI garment',
    demo: 'Demo',
    uploadedHint: 'Uploaded garment photo — a technical test, not a validated shop product.',
    uploadedLabel: (fileName: string) => `Uploaded: ${fileName}`,
    devInputs: 'Developer test inputs',
    usePhoto: 'Use a photo instead of the camera',
    category: 'Category',
    categories: { tops: 'Tops', bottoms: 'Bottoms', 'one-pieces': 'One-pieces' },
    photoType: 'Photo',
    photoTypes: { auto: 'Auto', 'flat-lay': 'Flat-lay / ghost', model: 'On model' },
    uploadGarment: 'Upload a garment photo',
    devHint: 'Test inputs only; uploads are validated by the server and never stored.',
    photoErrors: {
      type: 'Choose a JPEG, PNG or WebP photo.',
      size: 'That photo is too large.',
      read: 'That photo could not be read.',
      convert: 'That photo could not be converted.',
    },
    /** AI catalogue text by entry ID. */
    items: {
      'dress-green-lace': {
        label: 'Green lace dress',
        description: 'Women’s puff-sleeve lace dress',
        provenance: PRODUCT_NOTE,
      },
      'dress-teal-floral': {
        label: 'Teal floral dress',
        description: 'Women’s floral wrap midi dress',
        provenance: PRODUCT_NOTE,
      },
      'dress-cream-botanical': {
        label: 'Cream botanical dress',
        description: 'Women’s printed midi dress with gathered waist',
        provenance: PRODUCT_NOTE,
      },
      'jumpsuit-navy-sequin': {
        label: 'Navy sequin jumpsuit',
        description: 'Women’s wrap jumpsuit with sequin top and tie belt',
        provenance: PRODUCT_NOTE,
      },
      'jumpsuit-black-dot': {
        label: 'Black polka-dot jumpsuit',
        description: 'Women’s wide-leg jumpsuit with dotted mesh sleeves',
        provenance: PRODUCT_NOTE,
      },
      'thobe-white': {
        label: 'Saudi thobe',
        description: 'Men’s white collared thobe',
        provenance: PRODUCT_NOTE,
      },
      'thobe-gold-trim': {
        label: 'Gold-trim thobe',
        description: 'Men’s white round-neck thobe with gold trim',
        provenance: PRODUCT_NOTE,
      },
      'vneck-stone': {
        label: 'V-neck · Stone',
        description: 'Rolled-sleeve V-neck',
        provenance: RENDER_NOTE,
      },
      'vneck-navy': { label: 'V-neck · Navy', description: 'Rolled-sleeve V-neck', provenance: RENDER_NOTE },
    } as Record<string, { label: string; description: string; provenance: string }>,

    // Stage
    checking: 'Checking the AI service…',
    unconfigured: 'AI preview is unavailable on this device. See the panel for details.',
    notDeployed: 'AI photo mode is not available on this copy of the site. See the panel for details.',
    instructions:
      'Face the camera with your upper body in view and your arms slightly away from your body, then take a photo.',
    capture: 'Capture photo',
    stages: {
      submitting: 'Uploading your photo to the AI service…',
      queued: 'Waiting in the AI service queue…',
      generating: 'Generating your preview…',
    } as Record<string, string>,
    seconds: (n: number) => `${n} s`,
    reconnecting: 'Connection interrupted — still waiting for the same preview…',
    beforeAlt: 'Your photo before the AI preview',
    afterAlt: (garment: string) => `AI-generated preview: ${garment}`,
    captureAlt: 'Your captured photo',
    before: 'Before',
    after: 'After',
    sideBySide: 'Side by side',
    compare: 'Compare',
    generatedLabel: 'AI-generated preview',
    testBadge: 'TEST RESULT · not AI',
    yourPhoto: 'Your photo',
    disclaimer:
      'AI-generated: colours, logos, fit and details may differ from the real garment. Not a size guide.',
    retake: 'Retake',
    tryAnother: 'Try another garment',
    download: 'Download',
    downloadTitle: 'Save the AI-generated photo',
    generate: 'Generate preview',
    generateAgain: 'Generate again',
    chooseFirst: 'Choose a garment first',
    choosePanel: 'Choose a garment in the panel.',
    retakeNote: 'Retake stops waiting here; a request already sent may still be processed and counted.',
    error: (_code: AiErrorCode | 'network', message: string) => message,

    // Consent
    consentTitle: 'Send your photo for an AI preview?',
    consentTest:
      'Test mode: the offline fake provider is active. Nothing leaves this computer and the result is not AI.',
    consentBody: {
      pre: 'Your captured photo and the garment image are sent to ',
      accent: 'FASHN',
      post: ', a cloud AI service, to generate one still image. Nothing is uploaded until you agree.',
    } as AccentText,
    consentMore: 'What happens to the photo?',
    consentPoints: [
      'This screen keeps your photo and the result only in memory. The AI server keeps the generated image for a few minutes at most, so this screen can load it, and never stores your photo; ending the session deletes both at once.',
      'FASHN deletes its temporary copy of the photo after processing; the generated image stays retrievable there for up to 60 minutes, and request records (without images) are kept. FASHN states it does not train on customer content.',
      'Ending the session here cannot delete data already held by FASHN.',
    ],
    consentLink: 'FASHN data retention & privacy',
    notNow: 'Not now',
    agree: 'Agree & generate',
  },
  diag: {
    title: 'Diagnostics',
    showLandmarks: 'Show landmarks',
    quality: 'Quality',
    presets: { fast: 'Fast (Lite model)', balanced: 'Balanced (Full model)' } as Record<string, string>,
    delegate: 'Delegate',
    reloadHint: 'Changing quality or delegate reloads the model.',
    tracker: 'Tracker',
    note: 'Note',
    phase: 'Phase',
    raw: 'raw',
    people: 'People',
    shoulderVis: 'Shoulder vis L/R',
    hipVis: 'Hip vis L/R',
    yaw: 'Yaw est.',
    torsoRatio: 'Torso ratio',
    learned: '(learned)',
    defaultValue: '(default)',
    videoFps: 'Video frames/s',
    renderFps: 'Render/s',
    inferenceFps: 'Inference/s',
    inferenceMs: 'Inference ms',
    latency: 'Frame→pose ms',
    poseAge: 'Pose age ms',
    source: 'Source',
    processing: 'Processing',
    canvas: 'Canvas',
    frameLoop: 'Frame loop',
    framesSent: 'Frames sent/done',
    dropped: 'Dropped/stale',
    opacity: 'Opacity',
    garment3d: '3D garment',
    model: 'Model',
    modelSize: (tris: string, verts: string, joints: number) =>
      `${tris} tris · ${verts} verts · ${joints} joints`,
    mode: 'Mode',
    contextLost: ' (WebGL context lost)',
    orientation: 'Orientation',
    arms: 'Arms L/R',
    scale: 'Scale / torso',
    renderMs: 'Render ms',
    copyMs: 'Layer copy ms',
    renderSize: 'Render size',
    cutoutMs: 'Arm cutout ms',
    cloth: 'Cloth (experimental)',
    state: 'State',
    engine: 'Engine',
    particles: 'Particles / edges',
    colliders: 'colliders',
    solverMs: 'Solver ms',
    substeps: 'Substeps / dropped',
    resets: 'Resets',
    deviation: 'Max dev / stretch',
    tuning: {
      deviation: 'Max deviation ×',
      iterations: 'Iterations',
      bend: 'Bend compliance',
      damping: 'Damping',
      gravity: 'Gravity ×',
      substeps: 'Max substeps',
      colliders: 'Body colliders',
    },
    showRig: 'Show rig helpers (dev)',
    footnote:
      'Frame→pose: time from a video frame being presented to its pose result (capture, transfer, inference). Pose age: media-time gap between the displayed frame and the frame the pose came from. With landmarks on, magenta crosses mark the garment’s shoulder anchors (registration check) and yellow capsules the forearm cutouts.',
    aiTitle: 'AI photo (operator)',
    provider: 'Provider',
    fakeProvider: 'fake (offline test — not AI)',
    modelCredits: 'Model / credits',
    perOutput: (model: string, credits: number) => `${model} · ${credits} credit per output`,
    resultTtl: 'Local result TTL',
    ttl: (ttl: number, deadline: number) => `${ttl} s · job deadline ${deadline} s`,
    unavailable: 'Unavailable',
    aiPreset: 'AI preset',
    usageTitle: 'AI usage',
    today: 'Today (UTC)',
    todayValue: (used: number, cap: number, left: number, uncertain: number) =>
      `${used} / ${cap} credits · ${left} left${uncertain > 0 ? ` · ${uncertain} uncertain` : ''}`,
    balance: 'FASHN balance',
    balanceValue: (total: number, subscription: number, onDemand: number) =>
      `${total} credits (subscription ${subscription}, on-demand ${onDemand})`,
    day: 'Day (UTC)',
    images: 'Images',
    credits: 'Credits',
    failed: 'Failed',
    uncertain: 'Uncertain',
    usageHint:
      'History counts this computer only (last 30 days). The FASHN dashboard is the official billing record.',
    refreshUsage: 'Refresh usage',
  },
};

export type Messages = typeof en;
