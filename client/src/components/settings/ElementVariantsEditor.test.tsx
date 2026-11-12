import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ElementVariantsEditor from './ElementVariantsEditor';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: any, options?: any) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) =>
            String(options?.[name] ?? ''),
          )
        : _key,
  }),
}));

/**
 * The locator variants of one repository element: listed, added with a valid name, removed, and
 * always saved as the whole map.
 */

const variants = { angular22: { selector: '[data-test=buy]' } };

describe('ElementVariantsEditor', () => {
  it('lists the variants and removes one, saving what is left', () => {
    const onSave = vi.fn();
    render(
      <ElementVariantsEditor
        elementName="Buy"
        variants={variants}
        saving={false}
        onSave={onSave}
      />,
    );
    expect(screen.getByText('[data-test=buy]')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Remove variant angular22'));
    expect(onSave).toHaveBeenCalledWith({});
  });

  it('adds a variant next to the others', () => {
    const onSave = vi.fn();
    render(
      <ElementVariantsEditor
        elementName="Buy"
        variants={variants}
        saving={false}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText('Variant name for Buy'), { target: { value: 'react' } });
    fireEvent.change(screen.getByLabelText('Variant selector for Buy'), {
      target: { value: '#buy-react' },
    });
    fireEvent.click(screen.getByLabelText('Add variant'));
    expect(onSave).toHaveBeenCalledWith({ ...variants, react: { selector: '#buy-react' } });
  });

  it('refuses a name a run could not set, or a missing selector', () => {
    const onSave = vi.fn();
    render(
      <ElementVariantsEditor elementName="Buy" variants={{}} saving={false} onSave={onSave} />,
    );
    fireEvent.change(screen.getByLabelText('Variant name for Buy'), {
      target: { value: 'bad name' },
    });
    fireEvent.click(screen.getByLabelText('Add variant'));
    expect(screen.getByText(/A variant name is letters/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Variant name for Buy'), { target: { value: 'ok' } });
    fireEvent.click(screen.getByLabelText('Add variant'));
    expect(screen.getByText('A variant needs a selector.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});
