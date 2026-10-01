import { describe, expect, it } from 'vitest';
import { flatten, parsePageSource } from '@shared/mobile-inspector';
import { currentText, dragDirection, isSecretField, isTextField, recordTarget } from '@shared/mobile-recorder';

/** What a touch on the inspector's screenshot becomes as a recorded step (shared/mobile-recorder.ts). */

const ANDROID = parsePageSource(`<hierarchy><android.widget.FrameLayout bounds="[0,0][400,800]">
  <android.widget.EditText content-desc="email" text="" bounds="[40,300][360,360]"/>
  <android.widget.EditText resource-id="shop:id/pw" password="true" bounds="[40,380][360,440]"/>
  <android.widget.Button text="Sign in" bounds="[40,600][360,680]"/>
  <android.view.View bounds="[0,700][400,720]"/>
  <android.view.View bounds="[0,720][400,740]"/>
</android.widget.FrameLayout></hierarchy>`)!;
const IOS = parsePageSource(`<AppiumAUT><XCUIElementTypeApplication x="0" y="0" width="390" height="844">
  <XCUIElementTypeSecureTextField name="password" x="20" y="300" width="350" height="44"/>
  <XCUIElementTypeStaticText label="Total" value="12,00 €" x="20" y="400" width="350" height="30"/>
</XCUIElementTypeApplication></AppiumAUT>`)!;
const node = (root: typeof ANDROID, predicate: (n: (typeof ANDROID)) => boolean) => flatten(root).find(predicate)!;

describe('recordTarget', () => {
  it('uses the sturdiest unique locator, and flags one that only names a position', () => {
    expect(recordTarget(ANDROID, node(ANDROID, (n) => n.attributes['content-desc'] === 'email'), 'android')).toEqual({ locator: '~email', fragile: false });
    expect(recordTarget(ANDROID, node(ANDROID, (n) => n.attributes.text === 'Sign in'), 'android')).toEqual({ locator: 'text=Sign in', fragile: false });
    const anonymous = flatten(ANDROID).filter((n) => n.type === 'android.view.View')[1];
    expect(recordTarget(ANDROID, anonymous, 'android')).toEqual({
      locator: '/hierarchy/android.widget.FrameLayout[1]/android.view.View[2]',
      fragile: true,
    });
  });
});

describe('dragDirection', () => {
  const window = { width: 400, height: 800 };
  it('is null for a finger that hardly moved, and the dominant direction otherwise', () => {
    expect(dragDirection({ x: 200, y: 400 }, { x: 205, y: 410 }, window)).toBeNull();
    expect(dragDirection({ x: 200, y: 600 }, { x: 210, y: 200 }, window)).toBe('up');
    expect(dragDirection({ x: 200, y: 200 }, { x: 190, y: 600 }, window)).toBe('down');
    expect(dragDirection({ x: 350, y: 400 }, { x: 50, y: 420 }, window)).toBe('left');
    expect(dragDirection({ x: 50, y: 400 }, { x: 350, y: 380 }, window)).toBe('right');
  });
});

describe('text fields', () => {
  it('knows which fields take text and which hold a secret', () => {
    const [email, password] = flatten(ANDROID).filter((n) => n.type === 'android.widget.EditText');
    expect([isTextField(email), isSecretField(email)]).toEqual([true, false]);
    expect([isTextField(password), isSecretField(password)]).toEqual([true, true]);
    expect(isTextField(node(ANDROID, (n) => n.attributes.text === 'Sign in'))).toBe(false);
    const secure = node(IOS, (n) => n.type === 'XCUIElementTypeSecureTextField');
    expect([isTextField(secure), isSecretField(secure)]).toEqual([true, true]);
  });

  it('reads the text an assertion would check, per platform', () => {
    expect(currentText(node(ANDROID, (n) => n.attributes.text === 'Sign in'), 'android')).toBe('Sign in');
    expect(currentText(node(IOS, (n) => n.type === 'XCUIElementTypeStaticText'), 'ios')).toBe('12,00 €');
  });
});
