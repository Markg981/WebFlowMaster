import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MobileStepsEditor from './MobileStepsEditor';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
describe('native flow editor', () => {
  it('allows an optional target for conditions and reports malformed blocks', () => {
    render(
      <MobileStepsEditor
        platform="android"
        steps={[{ id: 'i', action: 'if', value: 'true' }]}
        groups={[]}
        allowGroups
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Element of step 1')).toBeInTheDocument();
    expect(screen.getByText(/has no.*endIf/)).toBeInTheDocument();
  });
  it('keeps selected group ids and filters incompatible groups', () => {
    const onChange = vi.fn();
    render(
      <MobileStepsEditor
        platform="android"
        steps={[{ id: 'g', action: 'callGroup' }]}
        groups={[
          { id: 'android', name: 'Android login', platform: 'android', steps: [] },
          { id: 'ios', name: 'iOS login', platform: 'ios', steps: [] },
        ]}
        allowGroups
        onChange={onChange}
      />,
    );
    expect(screen.queryByText('iOS login')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Group of step 1'), { target: { value: 'android' } });
    expect(onChange).toHaveBeenCalledWith([{ id: 'g', action: 'callGroup', value: 'android' }]);
  });
});
