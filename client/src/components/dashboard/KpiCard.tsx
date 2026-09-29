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
      // min-w-0: a grid item is otherwise as wide as its longest word, and a status such as
      // TIMED_OUT at 30px, or a German title, pushed past the card's edge in a four-column row.
      className={cn(
        'min-w-0 overflow-hidden rounded-lg border bg-card p-4 text-card-foreground shadow-sm',
        emphasis && 'ring-1 ring-inset ring-primary/25',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 break-words text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {icon && <div className="shrink-0 text-muted-foreground/60">{icon}</div>}
      </div>
      <div className="mt-2 min-h-[36px] min-w-0">
        {isScalar ? (
          <p className="font-mono text-2xl font-semibold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere] xl:text-[30px]">{value}</p>
        ) : (
          value
        )}
      </div>
      {hint && <div className="mt-2 break-words font-mono text-xs tabular-nums text-muted-foreground">{hint}</div>}
    </div>
  );
};

export default KpiCard;
