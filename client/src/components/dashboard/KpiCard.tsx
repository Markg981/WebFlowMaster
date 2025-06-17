import React from 'react';

interface KpiCardProps {
  title: string;
  value: string | number | React.ReactNode; // Updated to allow ReactNode for loading/error states
  icon?: React.ReactNode;
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, icon }) => {
  return (
    <div className="bg-card text-card-foreground p-4 rounded-lg shadow">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <div className="mt-1">{/* Changed p to div to better accommodate ReactNode values */}
        {typeof value === 'string' || typeof value === 'number' ? (
          <p className="text-3xl font-semibold">{value}</p>
        ) : (
          value // Render ReactNode directly (e.g. loader or error icon)
        )}
      </div>
    </div>
  );
};

export default KpiCard;
