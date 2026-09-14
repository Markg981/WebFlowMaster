import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { Bell, KeyRound, Sun } from 'lucide-react';

import { SettingsLayout, type SettingsSection } from './SettingsLayout';

/**
 * Settings was nine cards in one column, roughly three screens tall, with no way to see what
 * else the page held or to reach it other than scrolling past everything in between. A link
 * that said "create an environment in Settings" landed you at the top with nothing to point
 * at. These tests hold the two things the rail has to get right: only the chosen section is
 * on screen, and the choice survives being linked to and reloaded.
 */

const sections: SettingsSection[] = [
  {
    id: 'preferences',
    label: 'Preferences',
    icon: Sun,
    description: 'How the interface looks.',
    content: <p>appearance fields</p>,
    footer: <button type="button">Save user settings</button>,
  },
  {
    id: 'environments',
    label: 'Environments',
    icon: KeyRound,
    content: <p>environment list</p>,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    content: <p>notification switches</p>,
  },
];

const rail = () => within(screen.getByRole('navigation', { name: 'Settings sections' }));

const renderLayout = () =>
  render(<SettingsLayout sections={sections} navLabel="Settings sections" />);

beforeEach(() => {
  window.location.hash = '';
});

describe('SettingsLayout', () => {
  it('lists every section in the rail', () => {
    renderLayout();

    expect(rail().getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Preferences',
      'Environments',
      'Notifications',
    ]);
  });

  it('shows only the active section, so the page is one screen and not three', () => {
    renderLayout();

    expect(screen.getByText('appearance fields')).toBeInTheDocument();
    expect(screen.queryByText('environment list')).not.toBeInTheDocument();
    expect(screen.queryByText('notification switches')).not.toBeInTheDocument();
  });

  it('switches sections on click', () => {
    renderLayout();

    fireEvent.click(rail().getByRole('button', { name: 'Environments' }));

    expect(screen.getByText('environment list')).toBeInTheDocument();
    expect(screen.queryByText('appearance fields')).not.toBeInTheDocument();
  });

  it('marks the active section for assistive technology', () => {
    renderLayout();

    expect(rail().getByRole('button', { name: 'Preferences' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(rail().getByRole('button', { name: 'Environments' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('opens the section named by the URL fragment', () => {
    // What makes "create an environment in Settings" a link that can actually point at it.
    window.location.hash = 'environments';

    renderLayout();

    expect(screen.getByText('environment list')).toBeInTheDocument();
  });

  it('falls back to the first section when the fragment names nothing', () => {
    window.location.hash = 'does-not-exist';

    renderLayout();

    expect(screen.getByText('appearance fields')).toBeInTheDocument();
  });

  it('records the choice in the fragment, so a reload lands in the same place', () => {
    renderLayout();

    fireEvent.click(rail().getByRole('button', { name: 'Notifications' }));

    expect(window.location.hash).toBe('#notifications');
  });

  it('follows the fragment when the browser moves back', () => {
    renderLayout();

    fireEvent.click(rail().getByRole('button', { name: 'Environments' }));
    expect(screen.getByText('environment list')).toBeInTheDocument();

    window.location.hash = 'preferences';
    fireEvent(window, new HashChangeEvent('hashchange'));

    expect(screen.getByText('appearance fields')).toBeInTheDocument();
  });

  it('renders a section footer only for the section that owns it', () => {
    renderLayout();

    expect(screen.getByRole('button', { name: 'Save user settings' })).toBeInTheDocument();

    fireEvent.click(rail().getByRole('button', { name: 'Notifications' }));

    // A save bar under a section whose fields it does not write only invites the question
    // of what it would save.
    expect(screen.queryByRole('button', { name: 'Save user settings' })).not.toBeInTheDocument();
  });
});
