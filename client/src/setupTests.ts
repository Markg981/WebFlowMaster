// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/vitest';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import translationEN from './locales/en/translation.json';

// Components render through `t()`. Without an initialised i18next, react-i18next hands back
// the raw key, so every assertion on user-visible text fails. Initialise the real English
// bundle — pinned, with no language detector — so tests assert on what a user actually sees.
if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: translationEN } },
    lng: 'en',
    fallbackLng: 'en',
    debug: false,
    interpolation: { escapeValue: false },
  });
}

// JSDOM has no layout engine and therefore no ResizeObserver. Recharts, Radix and the
// Create Test page's screenshot-scaling effect all construct one on mount, which throws
// and unmounts the whole tree — so provide an inert stand-in.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as any);

// Radix primitives (Select, DropdownMenu, …) call these DOM APIs that JSDOM omits.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false;
  };
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
}

// Mock matchMedia for components that might use it (e.g. for responsiveness)
// Vitest/JSDOM doesn't have a layout engine.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock useToast hook globally for all tests to avoid errors if not specifically mocked in a
// test file and to prevent toasts from actually rendering during tests.
//
// The shape must stay complete: <Toaster /> reads `toasts` and maps over it, and the module
// also exports a standalone `toast` used outside components. Omitting either crashes any
// test that renders the real Toaster.
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
    dismiss: vi.fn(),
    toasts: [],
  }),
  toast: vi.fn(),
}));
