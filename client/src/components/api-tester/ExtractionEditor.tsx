import React from 'react';
import { Extraction, ExtractionSourceSchema } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, XCircle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

/**
 * Captures values from a response so later requests in the same plan can use them.
 *
 * Assertions could read a response; nothing could take a value out of one. So a saved API
 * test could only ever check a single endpoint in isolation, while the thing a tester
 * actually wants to verify is a flow — authenticate, create, read back, delete — where
 * every step after the first needs something the previous one returned.
 */

interface ExtractionEditorProps {
  extractions: Extraction[];
  onChange: (extractions: Extraction[]) => void;
  isExecuting?: boolean;
  /** What the last run captured, so the tester can see it worked before saving the test. */
  lastCaptured?: Record<string, string> | null;
  lastErrors?: Array<{ name: string; reason: string }> | null;
}

const sourceOptions = ExtractionSourceSchema.options;

/** Which sources need a property, and what that property is called for each. */
const propertyLabelBySource: Record<Extraction['source'], string | null> = {
  status_code: null,
  header: 'Header name',
  body_json_path: 'JSON path (e.g. data.id)',
  body_text: null,
};

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const ExtractionEditor: React.FC<ExtractionEditorProps> = ({
  extractions,
  onChange,
  isExecuting,
  lastCaptured,
  lastErrors,
}) => {
  const update = (id: string, patch: Partial<Extraction>) => {
    onChange(extractions.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const add = () => {
    onChange([
      ...extractions,
      { id: uuidv4(), name: '', source: 'body_json_path', property: '' },
    ]);
  };

  return (
    <div className="space-y-4 p-1">
      {extractions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing captured yet. Add a capture to reuse a value — a token, an id — in the
          requests that follow this one in a test plan.
        </p>
      )}

      {extractions.map((extraction) => {
        const propertyLabel = propertyLabelBySource[extraction.source];
        const nameIsValid = extraction.name === '' || NAME_PATTERN.test(extraction.name);
        const captured = lastCaptured?.[extraction.name];
        const failure = lastErrors?.find((e) => e.name === extraction.name);

        return (
          <div key={extraction.id} className="grid grid-cols-12 gap-2 items-start border-b pb-3">
            <div className="col-span-3">
              <Label htmlFor={`extraction-name-${extraction.id}`} className="text-xs">
                Variable name
              </Label>
              <Input
                id={`extraction-name-${extraction.id}`}
                value={extraction.name}
                placeholder="orderId"
                disabled={isExecuting}
                onChange={(e) => update(extraction.id, { name: e.target.value })}
              />
              {!nameIsValid && (
                <p className="text-xs text-destructive mt-1">
                  Letters, digits and underscores only, starting with a letter.
                </p>
              )}
              {nameIsValid && extraction.name !== '' && (
                <p className="text-xs text-muted-foreground mt-1">
                  Use as <code>{`{{${extraction.name}}}`}</code>
                </p>
              )}
            </div>

            <div className="col-span-3">
              <Label htmlFor={`extraction-source-${extraction.id}`} className="text-xs">
                From
              </Label>
              <Select
                value={extraction.source}
                disabled={isExecuting}
                onValueChange={(value: Extraction['source']) =>
                  update(extraction.id, {
                    source: value,
                    // A property left over from the previous source would be meaningless
                    // against the new one.
                    property: propertyLabelBySource[value] ? extraction.property : '',
                  })
                }
              >
                <SelectTrigger id={`extraction-source-${extraction.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sourceOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-4">
              {propertyLabel && (
                <>
                  <Label htmlFor={`extraction-property-${extraction.id}`} className="text-xs">
                    {propertyLabel}
                  </Label>
                  <Input
                    id={`extraction-property-${extraction.id}`}
                    value={extraction.property ?? ''}
                    disabled={isExecuting}
                    onChange={(e) => update(extraction.id, { property: e.target.value })}
                  />
                </>
              )}
              {/* The result of the last run, so a capture can be confirmed before the test
                  is saved rather than when a plan fails on the request after it. */}
              {captured !== undefined && (
                <p className="text-xs text-success mt-1 break-all">Captured: {captured}</p>
              )}
              {failure && (
                <p className="text-xs text-destructive mt-1">{failure.reason}</p>
              )}
            </div>

            <div className="col-span-2 flex justify-end pt-5">
              <Button
                variant="ghost"
                size="icon"
                type="button"
                disabled={isExecuting}
                aria-label={`Remove capture ${extraction.name || 'without a name'}`}
                onClick={() => onChange(extractions.filter((e) => e.id !== extraction.id))}
              >
                <XCircle className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        );
      })}

      <Button variant="outline" size="sm" type="button" onClick={add} disabled={isExecuting}>
        <PlusCircle className="mr-2 h-4 w-4" />
        Capture a value
      </Button>
    </div>
  );
};
