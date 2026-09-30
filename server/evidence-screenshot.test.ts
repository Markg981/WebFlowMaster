import { describe, it, expect, vi } from 'vitest';

/**
 * "Unable to capture screenshot" is Chromium's, and it came through a CI run as a failed
 * navigate step whose navigation had worked. These pin down that a missing picture never
 * becomes the step's result.
 */
const fakePage = (outcomes: Array<Buffer | Error>, closed = false) => {
  const screenshot = vi.fn(async () => {
    const next = outcomes.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  return {
    page: {
      screenshot,
      isClosed: () => closed,
      waitForLoadState: vi.fn(async () => {}),
    },
    screenshot,
  };
};

describe('evidenceScreenshot', () => {
  it('tries again once the page has settled, and returns the picture', async () => {
    const { evidenceScreenshot } = await import('./playwright-service');
    const png = Buffer.from('png');
    const { page, screenshot } = fakePage([new Error('Protocol error (Page.captureScreenshot): Unable to capture screenshot'), png]);
    const missing = vi.fn();

    expect(await evidenceScreenshot(page as never, missing)).toBe(png);
    expect(screenshot).toHaveBeenCalledTimes(2);
    expect(missing).not.toHaveBeenCalled();
  });

  it('returns nothing, and says why, when the picture cannot be had', async () => {
    const { evidenceScreenshot } = await import('./playwright-service');
    const { page } = fakePage([new Error('Unable to capture screenshot'), new Error('Unable to capture screenshot')]);
    const missing = vi.fn();

    await expect(evidenceScreenshot(page as never, missing)).resolves.toBeUndefined();
    expect(missing).toHaveBeenCalledWith('Unable to capture screenshot');
  });

  it('does not wait on a page that is already closed', async () => {
    const { evidenceScreenshot } = await import('./playwright-service');
    const { page, screenshot } = fakePage([new Error('Target closed')], true);

    await expect(evidenceScreenshot(page as never)).resolves.toBeUndefined();
    expect(screenshot).toHaveBeenCalledTimes(1);
    expect(page.waitForLoadState).not.toHaveBeenCalled();
  });
});
