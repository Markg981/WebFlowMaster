import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SchedulesList from './SchedulesList';
import type { TestPlanScheduleEnhanced } from '@/lib/api/schedules';

const mockSchedules: TestPlanScheduleEnhanced[] = [
  {
    id: '1',
    scheduleName: 'Daily Smoke Test',
    testPlanId: 'plan1',
    testPlanName: 'Main Test Plan',
    frequency: 'daily',
    nextRunAt: new Date('2024-08-01T09:00:00Z'),
    environment: 'QA',
    browsers: ['chromium', 'firefox'],
    isActive: true,
    retryOnFailure: 'none',
    notificationConfigOverride: null,
    executionParameters: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: '2',
    scheduleName: 'Weekly Regression',
    testPlanId: 'plan2',
    testPlanName: 'Regression Suite',
    frequency: 'cron:0 2 * * 1', // At 02:00 on Monday
    nextRunAt: new Date('2024-08-05T02:00:00Z'),
    environment: 'Staging',
    browsers: ['webkit'],
    isActive: false,
    retryOnFailure: 'once',
    notificationConfigOverride: null,
    executionParameters: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe('SchedulesList', () => {
  const mockOnEdit = vi.fn();
  const mockOnDelete = vi.fn();

  it('renders loading state', () => {
    render(
      <SchedulesList
        schedules={[]}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        isLoading={true}
      />
    );
    expect(screen.getByText('Loading schedules...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(
      <SchedulesList
        schedules={[]}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        isLoading={false}
        error={new Error('Failed to load')}
      />
    );
    expect(screen.getByText('Error loading schedules: Failed to load')).toBeInTheDocument();
  });

  it('renders "no schedules found" message when list is empty', () => {
    render(
      <SchedulesList
        schedules={[]}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        isLoading={false}
      />
    );
    expect(screen.getByText('No schedules found. Create one to get started!')).toBeInTheDocument();
  });

  it('renders a list of schedules', () => {
    render(
      <SchedulesList
        schedules={mockSchedules}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        isLoading={false}
      />
    );

    expect(screen.getByText('Daily Smoke Test')).toBeInTheDocument();
    expect(screen.getByText('Main Test Plan')).toBeInTheDocument();
    expect(screen.getByText('Daily')).toBeInTheDocument(); // Formatted frequency
    expect(screen.getByText('2024-08-01 09:00')).toBeInTheDocument(); // Formatted date
    expect(screen.getByText('QA')).toBeInTheDocument();
    expect(screen.getByText('chromium, firefox')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();

    expect(screen.getByText('Weekly Regression')).toBeInTheDocument();
    expect(screen.getByText('Regression Suite')).toBeInTheDocument();
    expect(screen.getByText('CRON (0 2 * * 1)')).toBeInTheDocument(); // Formatted CRON
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('calls onEdit when edit button is clicked', () => {
    render(
      <SchedulesList
        schedules={mockSchedules}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        isLoading={false}
      />
    );
    // Get all edit buttons. Since title is "Edit Schedule" for all:
    const editButtons = screen.getAllByTitle('Edit Schedule');
    fireEvent.click(editButtons[0]); // Click the first one
    expect(mockOnEdit).toHaveBeenCalledWith(mockSchedules[0]);
  });

  it('calls onDelete when delete button is clicked', () => {
    render(
      <SchedulesList
        schedules={mockSchedules}
        onEdit={mockOnEdit}
        onDelete={mockOnDelete}
        isLoading={false}
      />
    );
    const deleteButtons = screen.getAllByTitle('Delete Schedule');
    fireEvent.click(deleteButtons[0]); // Click the first one
    expect(mockOnDelete).toHaveBeenCalledWith(mockSchedules[0].id);
  });
});
