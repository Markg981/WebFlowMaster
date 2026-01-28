import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIAutomationService } from './ai-automation-service';
import { db } from './db';
import { tests, detectedElements } from '@shared/schema';

// Mock better-sqlite3 to avoid native binding errors
vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn(),
      }),
      exec: vi.fn(),
      pragma: vi.fn(),
    })),
  };
});

// Mock Google Generative AI
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

// Mock DB
vi.mock('./db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
  },
}));

// Mock Logger
vi.mock('./logger', () => ({
  default: Promise.resolve({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('AIAutomationService', () => {
  let service: AIAutomationService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test_key';
    service = new AIAutomationService();
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  describe('healSelector', () => {
    it('should return a new selector from AI response', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => 'div.new-selector' },
      });

      const result = await service.healSelector('div.old', '<html>...</html>', 'error');
      expect(result).toBe('div.new-selector');
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it('should return null if API key is missing', async () => {
        delete process.env.GEMINI_API_KEY;
        // Re-instantiate to pick up missing env
        service = new AIAutomationService();
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
    it('should return analysis text from AI', async () => {
        mockGenerateContent.mockResolvedValueOnce({
            response: { text: () => 'Analysis: Timeout issue.' },
        });

        const result = await service.analyzeFailure('Timeout', 'Stack...', [], '');
        expect(result).toBe('Analysis: Timeout issue.');
    });
  });

  describe('updateSelectorInDb', () => {
      it('should update legacy tests table and upsert detected_elements', async () => {
          const testId = 123;
          const stepIndex = 0;
          const sequence = [
              { targetElement: { id: 'el1', selector: 'div.old', tag: 'div' } }
          ];
          const newSelector = 'div.new';

          // Mock DB Select
          // First call: Get Test -> returns record
          // Second call: Get detectedElement -> returns empty (to force insert)
          const selectMock = vi.fn()
            .mockImplementationOnce(() => ({ // Query 1: tests
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([{ 
                    id: testId, 
                    sequence: sequence, 
                    elements: [{ id: 'el1', selector: 'div.old' }] 
                }]),
            }))
            .mockImplementationOnce(() => ({ // Query 2: detectedElements
                 from: vi.fn().mockReturnThis(),
                 where: vi.fn().mockReturnThis(), // and(...)
                 limit: vi.fn().mockResolvedValue([]),
            }));

          (db.select as any).mockImplementation(selectMock);

          await service.updateSelectorInDb(testId, stepIndex, newSelector);

          // Verify Legacy Update
          expect(db.update).toHaveBeenCalledWith(tests);
          
          // Verify Normalized Update (Insert path)
          expect(db.insert).toHaveBeenCalledWith(detectedElements);
      });
  });
});
