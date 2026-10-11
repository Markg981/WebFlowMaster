import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Calendar } from './calendar';

/** The wrapper over react-day-picker 9+, whose parts and navigation were renamed. */
describe('Calendar', () => {
  it('shows the month, moves to the next one and selects a day', () => {
    const onSelect = vi.fn();
    render(
      <Calendar mode="single" defaultMonth={new Date(2026, 0, 1)} onSelect={onSelect} autoFocus />,
    );
    expect(screen.getByText('January 2026')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    expect(screen.getByText('February 2026')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /February 14/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const picked = onSelect.mock.calls[0][0] as Date;
    expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual([2026, 1, 14]);
  });

  it('draws its own chevrons in the navigation buttons', () => {
    const { container } = render(<Calendar mode="single" defaultMonth={new Date(2026, 0, 1)} />);
    expect(container.querySelectorAll('nav button svg.lucide-chevron-left')).toHaveLength(1);
    expect(container.querySelectorAll('nav button svg.lucide-chevron-right')).toHaveLength(1);
  });
});
