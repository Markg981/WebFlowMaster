import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConversationPlanSchema, type ConversationPlan } from '@shared/protocol-conversation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Step = ConversationPlan['steps'][number];
const initialStep = (type: Step['type']): Step =>
  type === 'send' ? { type, message: '' } : type === 'capture' ? { type, name: 'value' } : { type };
const display = (value: unknown) =>
  value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const message = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export function ConversationEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [jsonMode, setJsonMode] = useState(false);
  const copy = (key: string, fallback: string) => t(`apiTester.conversation.${key}`, fallback);
  const stepLabel = (index: number, field: string) =>
    t('apiTester.conversation.stepField', 'Step {{index}} {{field}}', { index: index + 1, field });
  let plan: { steps: Step[] } | undefined;
  let isPlan = /"steps"\s*:/.test(value);
  try {
    const parsed = JSON.parse(value);
    isPlan =
      !!parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.hasOwn(parsed, 'steps');
    if (
      isPlan &&
      Array.isArray(parsed.steps) &&
      parsed.steps.length <= 100 &&
      parsed.steps.every(
        (step: unknown) =>
          !!step &&
          typeof step === 'object' &&
          ['send', 'receive', 'capture', 'end'].includes((step as Step).type),
      )
    )
      plan = parsed;
  } catch {
    /* Incomplete JSON stays editable verbatim. */
  }
  const invalid = isPlan && !ConversationPlanSchema.safeParse(plan).success;
  const update = (steps: Step[]) => onChange(JSON.stringify({ steps }, null, 2));
  const edit = (index: number, changes: Partial<Step>) =>
    plan &&
    update(plan.steps.map((step, i) => (i === index ? ({ ...step, ...changes } as Step) : step)));
  const move = (index: number, direction: number) => {
    if (!plan) return;
    const steps = [...plan.steps];
    [steps[index], steps[index + direction]] = [steps[index + direction], steps[index]];
    update(steps);
  };
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-md border p-4">
      <legend className="px-1 text-sm font-medium">{copy('title', 'Conversation')}</legend>
      <p className="text-xs text-muted-foreground">
        {t(
          'apiTester.conversation.help',
          'Receive a response, capture a value, then reuse it in a later send with {{capture.name}}. Legacy raw bodies stay unchanged until you create a conversation.',
          { interpolation: { skipOnVariables: true, prefix: '[[', suffix: ']]' } },
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {!isPlan && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setJsonMode(false);
              update([{ type: 'receive' }]);
            }}
          >
            {copy('create', 'Create conversation')}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setJsonMode((current) => !current)}
        >
          {copy(
            jsonMode ? 'builder' : 'json',
            jsonMode ? 'Ordered step editor' : 'Edit conversation JSON',
          )}
        </Button>
      </div>
      {jsonMode ? (
        <label className="grid gap-1 text-sm">
          {copy('jsonLabel', 'Conversation JSON')}
          <Textarea
            rows={10}
            className="font-mono text-xs"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      ) : (
        plan && (
          <>
            <ol className="space-y-3">
              {plan.steps.map((step, index) => (
                <li key={index} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{index + 1}.</span>
                    <select
                      aria-label={stepLabel(index, copy('type', 'type'))}
                      className="rounded-md border bg-background p-2 text-sm"
                      value={step.type}
                      onChange={(event) =>
                        update(
                          plan!.steps.map((item, i) =>
                            i === index ? initialStep(event.target.value as Step['type']) : item,
                          ),
                        )
                      }
                    >
                      {(['send', 'receive', 'capture', 'end'] as const).map((type) => (
                        <option key={type} value={type}>
                          {copy(type, type)}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={index === 0}
                      aria-label={t('apiTester.conversation.moveUp', 'Move step {{index}} up', {
                        index: index + 1,
                      })}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={index === plan!.steps.length - 1}
                      aria-label={t('apiTester.conversation.moveDown', 'Move step {{index}} down', {
                        index: index + 1,
                      })}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={t('apiTester.conversation.remove', 'Remove step {{index}}', {
                        index: index + 1,
                      })}
                      onClick={() => update(plan!.steps.filter((_, i) => i !== index))}
                    >
                      ×
                    </Button>
                  </div>
                  {step.type === 'send' && (
                    <label className="grid gap-1 text-sm">
                      {copy('message', 'Message (text or JSON)')}
                      <Textarea
                        aria-label={stepLabel(index, copy('messageField', 'message'))}
                        className="font-mono text-xs"
                        value={display(step.message)}
                        onChange={(event) => edit(index, { message: message(event.target.value) })}
                      />
                    </label>
                  )}
                  {step.type === 'receive' && (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="grid gap-1 text-sm">
                        {copy('timeout', 'Step timeout (ms)')}
                        <Input
                          aria-label={stepLabel(index, copy('timeoutField', 'timeout'))}
                          type="number"
                          min={1}
                          max={60000}
                          value={step.timeoutMs ?? ''}
                          onChange={(event) =>
                            edit(index, {
                              timeoutMs: event.target.value
                                ? Number(event.target.value)
                                : undefined,
                            })
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        {copy('property', 'JSON path (optional)')}
                        <Input
                          aria-label={stepLabel(index, copy('propertyField', 'property'))}
                          value={step.property ?? ''}
                          onChange={(event) =>
                            edit(index, { property: event.target.value || undefined })
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        {copy('equals', 'Expected value (optional)')}
                        <Input
                          aria-label={stepLabel(index, copy('equalsField', 'expected value'))}
                          value={display(step.equals)}
                          onChange={(event) =>
                            edit(index, {
                              equals: event.target.value ? message(event.target.value) : undefined,
                            })
                          }
                        />
                      </label>
                    </div>
                  )}
                  {step.type === 'capture' && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-sm">
                        {copy('name', 'Capture name')}
                        <Input
                          aria-label={stepLabel(index, copy('nameField', 'capture name'))}
                          value={step.name}
                          onChange={(event) => edit(index, { name: event.target.value })}
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        {copy('property', 'JSON path (optional)')}
                        <Input
                          aria-label={stepLabel(index, copy('propertyField', 'property'))}
                          value={step.property ?? ''}
                          onChange={(event) =>
                            edit(index, { property: event.target.value || undefined })
                          }
                        />
                      </label>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={plan.steps.length >= 100}
              onClick={() => update([...plan!.steps, { type: 'send', message: '' }])}
            >
              {copy('add', 'Add step')}
            </Button>
          </>
        )
      )}
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {copy(
            'invalid',
            'Invalid conversation. Check step order, capture names, timeouts and the 100-step limit. Use JSON editing to repair unsupported steps.',
          )}
        </p>
      )}
    </fieldset>
  );
}
