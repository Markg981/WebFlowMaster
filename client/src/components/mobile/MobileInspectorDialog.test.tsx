import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parsePageSource } from '@shared/mobile-inspector';
import MobileInspectorDialog from './MobileInspectorDialog';
import MobileTestDialog from './MobileTestDialog';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) => {
      let text = typeof fallback === 'string' ? fallback : _key;
      for (const [name, value] of Object.entries(options ?? {})) text = text.split(`{{${name}}}`).join(String(value));
      return text;
    },
  }),
}));

/** Picking elements on a device's screen, adding them as steps, and driving the device. */

const SIGN_IN = parsePageSource(`<hierarchy><android.widget.FrameLayout bounds="[0,0][400,800]">
  <android.widget.EditText content-desc="email" bounds="[40,300][360,360]"/>
  <android.widget.Button content-desc="login" text="Sign in" bounds="[40,600][360,680]"/>
</android.widget.FrameLayout></hierarchy>`);
const WELCOME = parsePageSource(`<hierarchy><android.widget.TextView text="Welcome" bounds="[40,80][360,140]"/></hierarchy>`);
const snapshot = (tree: unknown, extra: Record<string, unknown> = {}) => ({
  id: 'insp-1', platform: 'android', screenshot: 'iVBORw0KGgo=', window: { width: 400, height: 800 }, tree, device: 'Google Pixel 8 · Android 14', ...extra,
});
const request = { gridId: 'g1', platform: 'android' as const, app: 'bs://app', deviceName: 'Google Pixel 8', osVersion: '14.0' };

const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The picture is 200×400 on the page: half the device's 400×800.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => vi.restoreAllMocks());

describe('MobileInspectorDialog', () => {
  it('opens the device, picks the element clicked on the screen, and adds a step with its locator', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? reply(null, 204) : reply(snapshot(SIGN_IN), 201),
    );
    const onAddStep = vi.fn();
    const onClose = vi.fn();
    render(<MobileInspectorDialog isOpen request={request} onClose={onClose} onAddStep={onAddStep} />);
    expect(screen.getByTestId('inspector-opening')).toHaveTextContent('finding a Google Pixel 8');
    const picture = await screen.findByAltText("The device's screen");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(request);
    expect(screen.getByText('Google Pixel 8 · Android 14')).toBeTruthy();

    // (100, 320) on the picture is (200, 640) on the device: the sign-in button.
    fireEvent.click(picture, { clientX: 100, clientY: 320 });
    const element = screen.getByTestId('inspector-element');
    expect(element).toHaveTextContent('Button');
    const locators = within(element).getAllByTestId('inspector-locator').map((row) => row.querySelector('code')!.textContent);
    expect(locators[0]).toBe('~login');
    expect(screen.getByTestId('inspector-selected')).toHaveStyle({ left: '10%', top: '75%' });

    fireEvent.click(screen.getByLabelText('Add step with ~login'));
    expect(onAddStep).toHaveBeenCalledWith({ action: 'tap', target: '~login' });
    expect(screen.getByTestId('inspector-added')).toHaveTextContent('1 step(s) added');

    // Closing gives the device back.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/mobile-inspector/insp-1' && init?.method === 'DELETE')).toBe(true);
  });

  it('drives the device, records what was done as steps, and shows a step that failed', async () => {
    let screenNow: unknown = SIGN_IN;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/mobile-inspector') return reply(snapshot(SIGN_IN), 201);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.kind === 'tapAt') {
        screenNow = WELCOME;
        return reply(snapshot(WELCOME, { error: null }));
      }
      if (body?.step?.target === '~email') return reply(snapshot(SIGN_IN, { error: null }));
      return reply(snapshot(screenNow, { error: 'No visible element ~login within 5s.' }));
    });
    const onAddStep = vi.fn();
    render(<MobileInspectorDialog isOpen request={request} onClose={() => {}} onAddStep={onAddStep} />);
    await screen.findByAltText("The device's screen");
    fireEvent.click(screen.getByText('Record what I do here as steps'));

    // Picked from the list, then typed into on the device.
    fireEvent.click(within(screen.getByTestId('inspector-tree')).getByText(/EditText/));
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'ann@shop.test' } });
    fireEvent.click(screen.getByText('Type it'));
    await waitFor(() => expect(onAddStep).toHaveBeenCalledWith({ action: 'type', target: '~email', value: 'ann@shop.test' }));
    const typed = fetchMock.mock.calls.find(([url]) => url === '/api/mobile-inspector/insp-1/actions')!;
    expect(JSON.parse(typed[1].body).step).toMatchObject({ action: 'type', target: '~email', value: 'ann@shop.test' });

    // A tap on the picture in tap mode goes to the device, in its coordinates.
    fireEvent.click(screen.getByText('Tap on the device'));
    fireEvent.click(screen.getByAltText("The device's screen"), { clientX: 100, clientY: 320 });
    await waitFor(() => expect(within(screen.getByTestId('inspector-tree')).getByText(/Welcome/)).toBeTruthy());
    const tap = fetchMock.mock.calls.filter(([url]) => url === '/api/mobile-inspector/insp-1/actions').pop()!;
    expect(JSON.parse(tap[1].body)).toEqual({ kind: 'tapAt', x: 200, y: 640 });

    fireEvent.click(screen.getByText('Select'));
    fireEvent.click(within(screen.getByTestId('inspector-tree')).getByText(/Welcome/));
    fireEvent.click(screen.getByText('Tap it on the device'));
    expect((await screen.findByRole('alert')).textContent).toBe('No visible element ~login within 5s.');
    // A step that failed is not recorded.
    expect(onAddStep).toHaveBeenCalledTimes(1);
  });

  it('says why the device could not be opened', async () => {
    fetchMock.mockImplementation(() => reply({ error: 'BrowserStack: Could not find device Google Pixel 99' }, 502));
    render(<MobileInspectorDialog isOpen request={{ ...request, deviceName: 'Google Pixel 99' }} onClose={() => {}} onAddStep={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toBe('BrowserStack: Could not find device Google Pixel 99');
  });
});

describe('MobileTestDialog and the inspector', () => {
  it('opens it only with a grid, the app and the device, and puts the picked step in place of the blank one', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => (init?.method === 'DELETE' ? reply(null, 204) : reply(snapshot(SIGN_IN), 201)));
    render(<MobileTestDialog isOpen test={null} grids={[{ id: 'g1', name: 'BrowserStack', provider: 'browserstack' }]} onClose={() => {}} onSaved={() => {}} />);
    const inspector = screen.getByText('Inspector').closest('button')!;
    expect(inspector).toBeDisabled();
    fireEvent.change(screen.getByLabelText('App'), { target: { value: 'bs://app' } });
    fireEvent.change(screen.getByLabelText('Device'), { target: { value: 'Google Pixel 8' } });
    expect(inspector).not.toBeDisabled();

    fireEvent.click(inspector);
    await screen.findByAltText("The device's screen");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ gridId: 'g1', app: 'bs://app', deviceName: 'Google Pixel 8', platform: 'android' });
    fireEvent.click(within(screen.getByTestId('inspector-tree')).getByText(/Button/));
    fireEvent.click(screen.getByLabelText('Add step with ~login'));
    expect(screen.getAllByLabelText(/^Element of step/)).toHaveLength(1);
    expect(screen.getByLabelText('Element of step 1')).toHaveValue('~login');
  });
});
