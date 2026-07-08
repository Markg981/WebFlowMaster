import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { db } from './db';
import { tests, detectedElements, users } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

// Mock only genuinely external / non-deterministic dependencies:
//  - Google Gemini (a real network API we must not call in tests)
//  - the logger (to keep test output clean)
// The database is NOT mocked: these tests run against the real PGlite test DB.
const { mockGenerateContent } = vi.hoisted(() => {
  return { mockGenerateContent: vi.fn() };
});

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      generateContent: mockGenerateContent,
    })),
  })),
}));

vi.mock('./logger', () => ({
  default: Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Import after the mocks are registered.
const { AIAutomationService } = await import('./ai-automation-service');

describe('AIAutomationService', () => {
  let service: InstanceType<typeof AIAutomationService>;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test_key';
    service = new AIAutomationService();

    // Clean slate (respect FK order: detected_elements -> tests -> users).
    await db.delete(detectedElements);
    await db.delete(tests);
    await db.delete(users);
  });

  afterAll(async () => {
    await db.delete(detectedElements);
    await db.delete(tests);
    await db.delete(users);
    delete process.env.GEMINI_API_KEY;
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

  describe('analyzeFailure', () => {
    it('should return analysis text from the AI', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => 'Analysis: Timeout issue.' },
      });

      const result = await service.analyzeFailure('Timeout', 'Stack...', [], '');
      expect(result).toBe('Analysis: Timeout issue.');
    });
  });

  describe('updateSelectorInDb', () => {
    it('updates the sequence, the elements repository and upserts detected_elements', async () => {
      // Seed a real user + test.
      const [user] = await db
        .insert(users)
        .values({ username: 'ai-heal-user', password: 'hashed' })
        .returning();

      const sequence = [
        {
          targetElement: {
            id: 'el1',
            selector: 'div.old',
            tag: 'div',
            text: 'Click me',
            attributes: { role: 'button' },
          },
        },
      ];
      const elements = [{ id: 'el1', selector: 'div.old' }];

      const [seededTest] = await db
        .insert(tests)
        .values({
          userId: user.id,
          name: 'Healing test',
          url: 'http://example.com',
          sequence, // jsonb column — pass the object directly (no JSON.stringify)
          elements,
        })
        .returning();

      await service.updateSelectorInDb(seededTest.id, 0, 'div.new');

      // The sequence step and the elements repository should now carry the healed selector.
      const [updated] = await db.select().from(tests).where(eq(tests.id, seededTest.id)).limit(1);
      const updatedSequence = updated.sequence as any[];
      const updatedElements = updated.elements as any[];
      expect(updatedSequence[0].targetElement.selector).toBe('div.new');
      expect(updatedElements[0].selector).toBe('div.new');

      // A normalized detected_elements row should have been inserted for the element.
      const detected = await db
        .select()
        .from(detectedElements)
        .where(and(eq(detectedElements.testId, seededTest.id), eq(detectedElements.elementId, 'el1')))
        .limit(1);
      expect(detected.length).toBe(1);
      expect(detected[0].selector).toBe('div.new');
    });
  });
});
