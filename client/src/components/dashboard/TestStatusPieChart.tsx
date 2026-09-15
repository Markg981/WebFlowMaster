import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Loader2, PieChart as PieChartIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export type ExecutionStatus = 'passed' | 'failed' | 'pending';

export interface StatusSlice {
  status: ExecutionStatus;
  value: number;
}

interface TestStatusPieChartProps {
  data?: StatusSlice[];
  isLoading?: boolean;
}

/**
 * Slice colours come from the theme, not from the server.
 *
 * The aggregation used to send `fill: '#10b981'` with each slice, so the chart was the one
 * part of the interface that could not follow the light/dark tokens.
 */
const SLICE_COLOUR: Record<ExecutionStatus, string> = {
  passed: 'hsl(var(--success))',
  failed: 'hsl(var(--destructive))',
  pending: 'hsl(var(--warning))',
};

const SLICE_LABEL: Record<ExecutionStatus, string> = {
  passed: 'dashboard.executionStatus.passed',
  failed: 'dashboard.executionStatus.failed',
  pending: 'dashboard.executionStatus.pending',
};

const TestStatusPieChart: React.FC<TestStatusPieChartProps> = ({ data, isLoading }) => {
  const { t } = useTranslation();

  const slices = (data ?? []).filter((slice) => slice.value > 0);
  const hasRuns = slices.length > 0;

  return (
    <div className="bg-card text-card-foreground p-4 rounded-lg border shadow-sm h-80 w-full flex flex-col">
      <h3 className="mb-4 text-base font-semibold">
        {t('dashboard.testStatusPieChart.testStatusOverview.title', 'Execution Status Breakdown')}
      </h3>
      <div className="flex-1 w-full h-full min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin h-8 w-8 text-muted-foreground" />
          </div>
        ) : !hasRuns ? (
          /* The first thing a new account sees. It names what is missing and offers the one
             thing that fixes it, instead of reporting that a query came back empty. */
          <EmptyState
            compact
            icon={PieChartIcon}
            title={t('dashboard.emptyExecutions.title')}
            description={t('dashboard.emptyExecutions.description')}
            action={
              <Button asChild size="sm">
                <Link href="/dashboard/create-test">{t('dashboard.emptyExecutions.action')}</Link>
              </Button>
            }
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices.map((slice) => ({ ...slice, name: t(SLICE_LABEL[slice.status]) }))}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
                stroke="none"
              >
                {slices.map((slice) => (
                  <Cell key={slice.status} fill={SLICE_COLOUR[slice.status]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ borderRadius: '10px', backgroundColor: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', border: '1px solid hsl(var(--border))', boxShadow: 'var(--shadow-md)', fontSize: '12px' }}
                itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
              />
              <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default TestStatusPieChart;
