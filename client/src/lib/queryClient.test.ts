import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage } from './queryClient';

describe('errorMessage', () => {
  it("shows the server's sentence rather than the status and JSON", () => {
    const body = { message: 'That invitation is not valid.' };
    expect(errorMessage(new ApiError(400, body, `400: ${JSON.stringify(body)}`))).toBe(
      'That invitation is not valid.',
    );
    expect(errorMessage(new ApiError(403, { error: 'Not allowed.' }, '403: …'))).toBe(
      'Not allowed.',
    );
  });

  it('falls back to the error text when the server sent no sentence', () => {
    expect(errorMessage(new ApiError(502, 'Bad gateway', '502: Bad gateway'))).toBe(
      '502: Bad gateway',
    );
    expect(errorMessage(new ApiError(500, {}, '500: {}'))).toBe('500: {}');
    expect(errorMessage(new Error('offline'))).toBe('offline');
    expect(errorMessage('plain')).toBe('plain');
  });
});
