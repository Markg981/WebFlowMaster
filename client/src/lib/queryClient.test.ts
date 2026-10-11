import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
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

describe('mutationCache', () => {
  it('shows a toast for a failed mutation that handles no error itself', async () => {
    const { mutationCache } = await import('./queryClient');
    const { toast } = await import('@/hooks/use-toast');
    const toastMock = vi.mocked(toast);
    toastMock.mockClear();
    const client = new QueryClient({ mutationCache });
    const body = { message: 'The name is taken.' };
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => {
        throw new ApiError(409, body, `409: ${JSON.stringify(body)}`);
      },
    });
    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(ApiError);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', description: 'The name is taken.' }),
    );
  });

  it('stays quiet when the mutation has its own onError', async () => {
    const { mutationCache } = await import('./queryClient');
    const { toast } = await import('@/hooks/use-toast');
    const toastMock = vi.mocked(toast);
    toastMock.mockClear();
    const client = new QueryClient({ mutationCache });
    const onError = vi.fn();
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => {
        throw new Error('offline');
      },
      onError,
    });
    await expect(mutation.execute(undefined)).rejects.toThrow('offline');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(toastMock).not.toHaveBeenCalled();
  });
});
