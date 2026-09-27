/**
 * Keeps a left-to-right run (a number with a Latin unit, a command) in reading order inside Arabic
 * text: wraps it in Unicode "left-to-right isolate" marks, so "16 ms" never shows as "ms 16".
 */
export const ltr = (text: string) => `⁦${text}⁩`;
