/**
 * Phones and tablets a plan can emulate: a browser with the device's screen, pixel density,
 * touch, mobile layout and user agent (Playwright's device registry).
 *
 * Emulation is the mobile web as a responsive site sees it — the layout, the menus that only
 * exist on a small screen, touch instead of hover — in the engine the runner has. It is not a
 * real phone: iOS Safari's own quirks, the keyboard covering a field, the device's performance
 * are what real devices are for (docs/en/guide/running.md#mobile-devices).
 *
 * A curated list rather than all of Playwright's hundred: the devices people test on now, each
 * name exactly as Playwright knows it (server/devices.test.ts checks every one).
 */

export type DevicePlatform = 'ios' | 'android';

export interface DeviceOption {
  /** Playwright's name for it. */
  name: string;
  platform: DevicePlatform;
  kind: 'phone' | 'tablet';
}

export const MOBILE_DEVICES: DeviceOption[] = [
  { name: 'iPhone 15', platform: 'ios', kind: 'phone' },
  { name: 'iPhone 15 Pro Max', platform: 'ios', kind: 'phone' },
  { name: 'iPhone 14', platform: 'ios', kind: 'phone' },
  { name: 'iPhone SE (3rd gen)', platform: 'ios', kind: 'phone' },
  { name: 'iPhone 13 Mini', platform: 'ios', kind: 'phone' },
  { name: 'Pixel 7', platform: 'android', kind: 'phone' },
  { name: 'Pixel 5', platform: 'android', kind: 'phone' },
  { name: 'Galaxy S24', platform: 'android', kind: 'phone' },
  { name: 'Galaxy A55', platform: 'android', kind: 'phone' },
  { name: 'iPad Pro 11', platform: 'ios', kind: 'tablet' },
  { name: 'iPad Pro 11 landscape', platform: 'ios', kind: 'tablet' },
  { name: 'iPad Mini', platform: 'ios', kind: 'tablet' },
  { name: 'Galaxy Tab S9', platform: 'android', kind: 'tablet' },
  { name: 'Galaxy Tab S9 landscape', platform: 'android', kind: 'tablet' },
];

export const MOBILE_DEVICE_NAMES = MOBILE_DEVICES.map((device) => device.name);

export function isMobileDevice(name: string | null | undefined): boolean {
  return !!name && MOBILE_DEVICE_NAMES.includes(name);
}

/**
 * Whether a browser can emulate a device. Firefox cannot: Playwright has no mobile mode for it,
 * so a phone on Firefox would be a desktop page in a small window, which is not what anyone asked.
 */
export function canEmulateDevice(browserName: string | null | undefined): boolean {
  return (browserName ?? '').trim().toLowerCase() !== 'firefox';
}
