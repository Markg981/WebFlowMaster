import { PlusCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import type { KeyValuePair } from './request-model';

type Props = {
  rows: KeyValuePair[];
  /** Prefix of each row's checkbox id, unique per list on the page. */
  idPrefix: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  disabled: boolean;
  onChange: (index: number, field: 'key' | 'value' | 'enabled', value: string | boolean) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
};

/** The enable / key / value / remove rows used for query parameters, headers and urlencoded bodies. */
export function KeyValueEditor({
  rows,
  idPrefix,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  disabled,
  onChange,
  onAdd,
  onRemove,
}: Props) {
  return (
    <>
      {rows.map((row, index) => (
        <div key={row.id} className="flex items-center space-x-2">
          <Checkbox
            id={`${idPrefix}-enabled-${row.id}`}
            checked={row.enabled}
            onCheckedChange={(checked) => onChange(index, 'enabled', !!checked)}
            disabled={disabled}
          />
          <Input
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(e) => onChange(index, 'key', e.target.value)}
            className="flex-1"
            disabled={disabled}
          />
          <Input
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={(e) => onChange(index, 'value', e.target.value)}
            className="flex-1"
            disabled={disabled}
          />
          <Button variant="ghost" size="icon" onClick={() => onRemove(index)} disabled={disabled}>
            <XCircle className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={onAdd} disabled={disabled}>
        <PlusCircle className="mr-2 h-4 w-4" /> {addLabel}
      </Button>
    </>
  );
}
