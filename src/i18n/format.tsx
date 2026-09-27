import { Fragment, type ReactNode } from 'react';
import type { AccentText } from './en';

/** Renders a message's `backtick` spans as <code> (commands, file and variable names). */
export function withCode(text: string): ReactNode {
  return text.split('`').map((part, i) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string never reorder.
    i % 2 === 1 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>,
  );
}

/** A heading with one highlighted part (gradient text by default). */
export function Accent({ text, className = 'gradient-text' }: { text: AccentText; className?: string }) {
  return (
    <>
      {text.pre}
      <span className={className}>{text.accent}</span>
      {text.post}
    </>
  );
}

/** "Label (key)" for a control's tooltip. */
export const withKey = (label: string, key: string) => `${label} (${key})`;
