import type { AiError, AiErrorCode } from '../../src/ai/types';

/** An error with a sanitized, shopper-safe message and an HTTP status. */
export class AppError extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON(): AiError {
    return { code: this.code, message: this.message };
  }
}

/** Shopper-facing messages for job failures. Provider text is never shown verbatim. */
export const JOB_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  'not-configured': 'AI preview is not available on this device.',
  'bad-request': 'The request was not valid.',
  'consent-required': 'Please agree to the photo upload first.',
  'invalid-image': 'That image could not be used. Please try a different photo.',
  'image-too-large': 'That image is too large.',
  'unknown-garment': 'That garment is not in the AI catalogue.',
  'uploads-disabled': 'Garment uploads are disabled on this device.',
  'duplicate-conflict': 'This request was already sent with different photos.',
  busy: 'A preview is already being generated. Please wait for it to finish.',
  'rate-limited': 'Too many requests. Please wait a moment.',
  'daily-limit': 'The daily AI preview limit has been reached on this device.',
  'session-expired': 'Your AI session ended. Please start again.',
  'not-found': 'That preview no longer exists.',
  forbidden: 'This request is not allowed.',
  pose: 'The person could not be detected clearly. Face the camera with your upper body visible, then retake.',
  moderation: 'The images were rejected by the provider’s content safety check.',
  'image-load': 'The provider could not read the images.',
  'provider-auth': 'The AI service rejected this device’s credentials. Please ask staff for help.',
  'provider-credits': 'The AI service account has no credits left. Please ask staff for help.',
  'provider-busy': 'The AI service is busy. Please try again shortly.',
  'provider-failed': 'The AI service could not generate a preview this time.',
  'provider-output': 'The AI service returned an unusable image.',
  timeout: 'The preview took too long and was stopped here.',
  uncertain:
    'The AI service did not confirm the request. It was not sent again automatically, and it may still count as used.',
  internal: 'Something went wrong on this device.',
};

export function jobError(code: AiErrorCode): AiError {
  return { code, message: JOB_ERROR_MESSAGES[code] };
}
