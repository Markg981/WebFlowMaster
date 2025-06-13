import puppeteer, { Browser, Page } from 'puppeteer';

export interface DetectedElement {
  id: string;
  type: string;
  selector: string;
  text: string;
  tag: string;
  attributes: Record<string, string>;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export class PlaywrightService {
  private browser: Browser | null = null;

  async initialize() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      });
    }
  }

  async loadWebsite(url: string): Promise<{ success: boolean; screenshot?: string; html?: string; error?: string }> {
    try {
      await this.initialize();
      if (!this.browser) throw new Error('Browser not initialized');

      const page = await this.browser.newPage();
      
      // Set viewport and user agent
      await page.setViewport({ width: 1280, height: 720 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Navigate to the URL with timeout
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });

      // Wait for network to be idle
      await page.waitForTimeout(2000);

      // Get page content and screenshot
      const html = await page.content();
      const screenshot = await page.screenshot({ 
        type: 'png',
        fullPage: false
      });

      await page.close();

      return {
        success: true,
        screenshot: `data:image/png;base64,${screenshot.toString('base64')}`,
        html
      };
    } catch (error) {
      console.error('Error loading website:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async detectElements(url: string): Promise<DetectedElement[]> {
    try {
      await this.initialize();
      if (!this.context) throw new Error('Browser context not initialized');

      const page = await this.context.newPage();
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000 
      });

      // Wait for page to be interactive
      await page.waitForLoadState('networkidle', { timeout: 10000 });

      // Detect interactive elements
      const elements = await page.evaluate(() => {
        const interactiveSelectors = [
          'input:not([type="hidden"])',
          'button',
          'a[href]',
          'select',
          'textarea',
          '[onclick]',
          '[role="button"]',
          '[tabindex]:not([tabindex="-1"])',
          'h1, h2, h3, h4, h5, h6',
          'img[alt]',
          'form',
          '[data-testid]',
          '[data-test]'
        ];

        const detectedElements: any[] = [];
        
        interactiveSelectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          elements.forEach((element, index) => {
            const rect = element.getBoundingClientRect();
            
            // Only include visible elements
            if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
              const tagName = element.tagName.toLowerCase();
              const text = element.textContent?.trim() || '';
              const placeholder = element.getAttribute('placeholder') || '';
              const displayText = text || placeholder || element.getAttribute('alt') || `${tagName}-${index}`;

              // Generate unique selector
              let uniqueSelector = selector;
              if (element.id) {
                uniqueSelector = `#${element.id}`;
              } else if (element.className) {
                const classes = element.className.split(' ').filter(c => c.length > 0);
                if (classes.length > 0) {
                  uniqueSelector = `${tagName}.${classes[0]}`;
                }
              }

              // Determine element type
              let elementType = 'element';
              if (tagName === 'input') {
                elementType = element.getAttribute('type') || 'input';
              } else if (tagName === 'button' || element.getAttribute('role') === 'button') {
                elementType = 'button';
              } else if (tagName === 'a') {
                elementType = 'link';
              } else if (tagName.match(/h[1-6]/)) {
                elementType = 'heading';
              } else if (tagName === 'select') {
                elementType = 'select';
              } else if (tagName === 'textarea') {
                elementType = 'textarea';
              }

              // Get all attributes
              const attributes: Record<string, string> = {};
              Array.from(element.attributes).forEach(attr => {
                attributes[attr.name] = attr.value;
              });

              detectedElements.push({
                id: `elem-${tagName}-${index}-${Date.now()}`,
                type: elementType,
                selector: uniqueSelector,
                text: displayText.substring(0, 100), // Limit text length
                tag: tagName,
                attributes,
                boundingBox: {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height)
                }
              });
            }
          });
        });

        return detectedElements.slice(0, 50); // Limit to 50 elements
      });

      await page.close();
      return elements;
    } catch (error) {
      console.error('Error detecting elements:', error);
      return [];
    }
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

export const playwrightService = new PlaywrightService();

// Cleanup on process exit
process.on('SIGINT', () => playwrightService.close());
process.on('SIGTERM', () => playwrightService.close());