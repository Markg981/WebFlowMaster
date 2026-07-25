import React from 'react';
import { cn } from '../../lib/utils';

interface KpiCardProps {
  title: string;
  value: string | number | React.ReactNode;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  /** Emphasized card (Signal-tinted border). Use for the headline metric. */
  emphasis?: boolean;
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, icon, hint, emphasis }) => {
  const isScalar = typeof value === 'string' || typeof value === 'number';
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4 text-card-foreground shadow-sm',
        emphasis && 'ring-1 ring-inset ring-primary/25',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {icon && <div className="text-muted-foreground/60">{icon}</div>}
      </div>
      <div className="mt-2 min-h-[36px]">
        {isScalar ? (
          <p className="font-mono text-[30px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
        ) : (
          value
        )}
      </div>
      {hint && <div className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">{hint}</div>}
    </div>
  );
};

export default KpiCard;
