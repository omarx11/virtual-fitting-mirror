import universityLogo from '../assets/brand/qassim-university-logo.webp';
import universityMark from '../assets/brand/qassim-university-mark.webp';

/** Project identity shown in the sidebar credits, the welcome screen and the About dialog. */
export const BRAND = {
  appName: 'Fitting Mirror',
  tagline: 'Virtual try-on',
  builder: 'Lamya',
  university: 'Qassim University',
  projectKind: 'Graduation project',
  universityLogo,
  universityMark,
} as const;

/** Keyboard shortcuts (App's key handler is the source of truth; keep this list in step with it). */
export const SHORTCUTS: readonly { keys: readonly string[]; action: string }[] = [
  { keys: ['Space'], action: 'Play / pause the video' },
  { keys: ['[', ']'], action: 'Previous / next shirt' },
  { keys: ['G'], action: 'Show or hide the shirt' },
  { keys: ['M'], action: 'Mirror the view' },
  { keys: ['F'], action: 'Fullscreen' },
  { keys: ['S'], action: 'Fold or unfold the sidebar' },
  { keys: ['D'], action: 'Diagnostics' },
  { keys: ['?'], action: 'This list of shortcuts' },
  { keys: ['Esc'], action: 'Close a dialog' },
];
