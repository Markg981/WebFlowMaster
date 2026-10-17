import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { privilegedDb } from '../platform/db';
import { tests, detectedElements, users } from '@shared/schema';

// Mock only genuinely external / non-deterministic dependencies:
//  - Google Gemini (a real network API we must not call in tests)
//  - the logger (to keep test output clean)
// The database is NOT mocked: these tests run against the real PGlite test DB.
const { mockGenerateContent, mockGetGenerativeModel, mockWarn } = vi.hoisted(() => {
  return { mockGenerateContent: vi.fn(), mockGetGenerativeModel: vi.fn(), mockWarn: vi.fn() };
});

// A function, not an arrow: the service calls `new GoogleGenerativeAI(...)`, and Vitest 4 keeps a
// mock's implementation as written, so an arrow implementation cannot be constructed.
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(function GoogleGenerativeAI() {
    return {
      getGenerativeModel: mockGetGenerativeModel.mockImplementation(() => ({
        generateContent: mockGenerateContent,
      })),
    };
  }),
}));

vi.mock('../platform/logger', () => ({
  default: { info: vi.fn(), warn: mockWarn, error: vi.fn() },
}));

// Import after the mocks are registered.
const { AIAutomationService, geminiModel } = await import('./ai-automation-service');
const { GoogleGenerativeAI } = await import('@google/generative-ai');

describe('AIAutomationService', () => {
  let service: InstanceType<typeof AIAutomationService>;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test_key';
    service = new AIAutomationService();

    // Clean slate (respect FK order: detected_elements -> tests -> users).
    await privilegedDb.delete(detectedElements);
    await privilegedDb.delete(tests);
    await privilegedDb.delete(users);
  });

  afterAll(async () => {
    await privilegedDb.delete(detectedElements);
    await privilegedDb.delete(tests);
    await privilegedDb.delete(users);
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  describe('the model', () => {
    it('is GEMINI_MODEL, or gemini-2.0-flash, for healing as for everything else', async () => {
      expect(geminiModel({})).toBe('gemini-2.0-flash');
      expect(geminiModel({ GEMINI_MODEL: 'gemini-2.5-pro' })).toBe('gemini-2.5-pro');

      process.env.GEMINI_MODEL = 'gemini-2.5-pro';
      mockGenerateContent.mockResolvedValue({ response: { text: () => 'ok' } });
      await service.healSelector('div.old', '<html></html>', 'error');
      await service.proposeTestSteps('prompt');
      await service.explainFailure('why?');
      delete process.env.GEMINI_MODEL;

      expect(mockGetGenerativeModel).toHaveBeenCalledTimes(3);
      for (const [options] of mockGetGenerativeModel.mock.calls) {
        expect(options).toEqual({ model: 'gemini-2.5-pro' });
      }
    });

    it('is never built without a key: the service is off, and says so once', async () => {
      delete process.env.GEMINI_API_KEY;
      vi.mocked(GoogleGenerativeAI).mockClear();
      mockWarn.mockClear();

      const disabled = new AIAutomationService();
      expect(disabled.isAvailable()).toBe(false);
      expect(await disabled.healSelector('div.old', 'html', 'error')).toBeNull();
      expect(await disabled.proposeTestSteps('prompt')).toBeNull();
      expect(await disabled.explainFailure('why?')).toBeNull();

      // No client with a placeholder key, and so no call to Google that could only fail.
      expect(GoogleGenerativeAI).not.toHaveBeenCalled();
      expect(mockGetGenerativeModel).not.toHaveBeenCalled();
      expect(mockGenerateContent).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(mockWarn.mock.calls[0][0]).toBe('GEMINI_API_KEY not set. AI features disabled.');
    });
  });

  describe('healSelector', () => {
    it('should return a new selector from the AI response', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => 'div.new-selector' },
      });

      const result = await service.healSelector('div.old', '<html>...</html>', 'error');
      expect(result).toBe('div.new-selector');
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it('should return null if the API key is missing', async () => {
      delete process.env.GEMINI_API_KEY;
      service = new AIAutomationService(); // re-instantiate to pick up the missing env
      const result = await service.healSelector('div.old', 'html', 'error');
      expect(result).toBeNull();
    });

    it('should return null on API failure', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('API Error'));
      const result = await service.healSelector('div.old', 'html', 'error');
      expect(result).toBeNull();
    });
  });

  describe('explainFailure', () => {
    it('sends the prompt with the screenshot as an image, and returns the answer', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => '{"category":"timing"}' },
      });

      const result = await service.explainFailure('Why did it fail?', {
        bytes: Buffer.from('png'),
        contentType: 'image/png',
      });
      expect(result).toBe('{"category":"timing"}');
      expect(mockGenerateContent).toHaveBeenLastCalledWith([
        { text: 'Why did it fail?' },
        { inlineData: { mimeType: 'image/png', data: Buffer.from('png').toString('base64') } },
      ]);
    });

    it('returns nothing when the model fails', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('quota'));
      expect(await service.explainFailure('Why?')).toBeNull();
    });
  });

  describe('healSelector, a proposal only', () => {
    it('takes a fenced answer apart without touching the selector inside it', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => '```css\n.css-button > span\n```' },
      });
      expect(await service.healSelector('div.old', 'html', 'error')).toBe('.css-button > span');
    });

    it('keeps a locator that starts with "css", and refuses an answer that is not one locator (P13)', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => '```css-grid > a```' },
      });
      expect(await service.healSelector('div.old', 'html', 'error')).toBe('css-grid > a');
      mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => 'css=.btn' },
      });
      expect(await service.healSelector('div.old', 'html', 'error')).toBe('css=.btn');
      mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => 'Try this:\n#save' },
      });
      expect(await service.healSelector('div.old', 'html', 'error')).toBeNull();
    });

    it('has no way to write a selector anywhere: the target is decided from provenance (C05)', () => {
      expect('updateSelectorInDb' in service).toBe(false);
    });
  });
});
