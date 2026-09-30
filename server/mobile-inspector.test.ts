import { describe, it, expect, vi, afterEach } from 'vitest';
import { findNode, flatten, nodeAt, parsePageSource, suggestLocators } from '@shared/mobile-inspector';
import { parseMobileLocator } from '@shared/mobile';

/**
 * The inspector's reading of a screen — Appium's page source for Android and iOS — and the
 * locators it offers for an element: each one a step can use (shared/mobile.ts), unique ones first.
 */

const ANDROID = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<!-- UiAutomator2 -->
<hierarchy index="0" class="hierarchy" rotation="0" width="1080" height="2400">
  <android.widget.FrameLayout index="0" bounds="[0,0][1080,2400]">
    <android.widget.LinearLayout bounds="[0,100][1080,2300]">
      <android.widget.EditText resource-id="com.shop:id/email" content-desc="email" text="" bounds="[60,400][1020,520]"/>
      <android.widget.Button resource-id="com.shop:id/action" text="Sign in" bounds="[60,700][1020,820]"/>
      <android.widget.Button resource-id="com.shop:id/action" text="Help &amp; &quot;FAQ&quot;" bounds="[60,900][1020,1020]"/>
      <android.widget.TextView text="Sign in" bounds="[60,200][1020,300]"/>
      <android.widget.Button bounds="[60,1100][1020,1220]"></android.widget.Button>
    </android.widget.LinearLayout>
  </android.widget.FrameLayout>
</hierarchy>`;

const IOS = `<?xml version="1.0" encoding="UTF-8"?><AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Shop" label="Shop" x="0" y="0" width="390" height="844"><XCUIElementTypeWindow x="0" y="0" width="390" height="844"><XCUIElementTypeButton type="XCUIElementTypeButton" name="login" label="Sign in" x="20" y="600" width="350" height="50"/><XCUIElementTypeStaticText name="Welcome" label="Welcome" value="Welcome" x="20" y="100" width="350" height="40"/></XCUIElementTypeWindow></XCUIElementTypeApplication></AppiumAUT>`;

describe('reading a page source', () => {
  it('reads Android: types, attributes with their entities, bounds, and paths', () => {
    const root = parsePageSource(ANDROID)!;
    expect(root.type).toBe('hierarchy');
    const nodes = flatten(root);
    expect(nodes).toHaveLength(8);
    const help = nodes.find((n) => n.attributes.text?.startsWith('Help'))!;
    expect(help.attributes.text).toBe('Help & "FAQ"');
    expect(help.bounds).toEqual({ x: 60, y: 900, width: 960, height: 120 });
    expect(help.id).toBe('0.0.0.2');
    expect(findNode(root, '0.0.0.2')).toBe(help);
    // An element written with an explicit closing tag is a leaf like a self-closed one.
    expect(nodes[nodes.length - 1]).toMatchObject({ type: 'android.widget.Button', children: [] });
  });

  it('reads iOS bounds from x, y, width and height; and nothing from no XML', () => {
    const root = parsePageSource(IOS)!;
    const button = flatten(root).find((n) => n.attributes.name === 'login')!;
    expect(button).toMatchObject({ type: 'XCUIElementTypeButton', bounds: { x: 20, y: 600, width: 350, height: 50 } });
    expect(parsePageSource('')).toBeNull();
    expect(parsePageSource('not xml')).toBeNull();
  });

  it('finds the innermost element under a point', () => {
    const root = parsePageSource(ANDROID)!;
    expect(nodeAt(root, 500, 750)?.attributes.text).toBe('Sign in');
    expect(nodeAt(root, 10, 50)?.type).toBe('android.widget.FrameLayout');
    expect(nodeAt(root, 5000, 5000)).toBeNull();
  });
});

describe('the locators offered', () => {
  const root = parsePageSource(ANDROID)!;
  const byText = (text: string) => flatten(root).find((n) => n.attributes.text === text && n.type.endsWith('Button'))!;

  it('offers the accessibility id first when it is unique', () => {
    const email = flatten(root).find((n) => n.attributes['content-desc'] === 'email')!;
    const offered = suggestLocators(root, email, 'android');
    expect(offered[0]).toEqual({ kind: 'accessibility', locator: '~email', unique: true });
    expect(offered.map((s) => s.locator)).toEqual(['~email', 'id=com.shop:id/email', '//android.widget.EditText[@resource-id="com.shop:id/email"]']);
  });

  it('marks what finds more than one element, and puts the unique ones first', () => {
    const offered = suggestLocators(root, byText('Sign in'), 'android');
    // The resource id is shared with Help, and "Sign in" is also the title's text.
    expect(offered.find((s) => s.kind === 'id')).toMatchObject({ locator: 'id=com.shop:id/action', unique: false });
    expect(offered.find((s) => s.kind === 'text')).toMatchObject({ locator: 'text=Sign in', unique: false });
    expect(offered[0].unique).toBe(true);
    expect(offered[0].locator).toBe('/hierarchy/android.widget.FrameLayout[1]/android.widget.LinearLayout[1]/android.widget.Button[1]');
  });

  it('quotes an XPath value holding quotes, and falls back to the position for an element with no name', () => {
    const help = suggestLocators(root, byText('Help & "FAQ"'), 'android');
    expect(help.find((s) => s.kind === 'text')).toMatchObject({ locator: 'text=Help & "FAQ"', unique: true });
    const unnamed = flatten(root)[flatten(root).length - 1];
    expect(suggestLocators(root, unnamed, 'android')).toEqual([
      { kind: 'xpath', locator: '/hierarchy/android.widget.FrameLayout[1]/android.widget.LinearLayout[1]/android.widget.Button[3]', unique: true },
    ]);
  });

  it('offers on iOS the name as accessibility id and the label as text', () => {
    const ios = parsePageSource(IOS)!;
    const button = flatten(ios).find((n) => n.attributes.name === 'login')!;
    expect(suggestLocators(ios, button, 'ios').map((s) => s.locator)).toEqual(['~login', 'text=Sign in', '//XCUIElementTypeButton[@name="login"]']);
    const welcome = flatten(ios).find((n) => n.attributes.name === 'Welcome')!;
    expect(suggestLocators(ios, welcome, 'ios').find((s) => s.kind === 'text')?.unique).toBe(true);
  });

  it('offers only locators a step can use', () => {
    for (const node of flatten(root).slice(1)) {
      for (const offered of suggestLocators(root, node, 'android')) expect(parseMobileLocator(offered.locator, 'android')).not.toBeNull();
    }
  });
});

describe('an inspector session left alone', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is closed on the grid after the idle time', async () => {
    vi.stubEnv('MOBILE_INSPECTOR_IDLE_MS', '1000');
    vi.useFakeTimers();
    const { inspectorDeps, openInspector, inspectorSnapshot } = await import('./mobile-inspector');
    const calls: string[] = [];
    inspectorDeps.fetch = async (url, init) => {
      calls.push(`${init.method} ${url}`);
      const value = url.endsWith('/session')
        ? { sessionId: 's1', capabilities: { platformVersion: '14' } }
        : url.endsWith('/source')
          ? ANDROID
          : url.endsWith('/window/rect')
            ? { width: 1080, height: 2400 }
            : null;
      return new Response(JSON.stringify({ value }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const owner = { organizationId: 1, userId: 1 };
    const grid = { id: 'g', name: 'BrowserStack', provider: 'browserstack' as const, username: 'u', endpoint: null, key: 'k' };
    const opened = await openInspector(owner, grid, { platform: 'android', app: 'bs://a', deviceName: 'Google Pixel 8', osVersion: null, name: 'Inspector' });
    expect(opened.device).toBe('Google Pixel 8 · Android 14');
    expect(opened.tree?.type).toBe('hierarchy');

    await vi.advanceTimersByTimeAsync(1_500);
    expect(calls.some((c) => c.startsWith('DELETE ') && c.endsWith('/session/s1'))).toBe(true);
    await expect(inspectorSnapshot(opened.id, owner)).rejects.toMatchObject({ status: 404 });
  });
});
