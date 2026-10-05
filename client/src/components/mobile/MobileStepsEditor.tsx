import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  MOBILE_ACTIONS,
  MOBILE_ACTION_IDS,
  mobileStepProblem,
  mobileFlowSteps,
  type MobileStep,
  type MobilePlatform,
  type MobileActionId,
} from '@shared/mobile';
import { analyseFlow, flowDepths } from '@shared/flow';
import type { MobileGroupDefinition } from '@shared/mobile-groups';

const labels: Record<MobileActionId, string> = {
  tap: 'Tap',
  type: 'Type',
  clear: 'Clear',
  waitFor: 'Wait for element',
  assertVisible: 'Assert visible',
  assertNotVisible: 'Assert not visible',
  assertText: 'Assert text contains',
  swipe: 'Swipe',
  back: 'Back',
  hideKeyboard: 'Hide keyboard',
  wait: 'Wait (seconds)',
  if: 'If',
  else: 'Else',
  endIf: 'End if',
  repeat: 'Repeat',
  repeatWhile: 'Repeat while',
  endLoop: 'End loop',
  assertCondition: 'Assert condition',
  callGroup: 'Call mobile group',
};
interface Props {
  steps: MobileStep[];
  platform: MobilePlatform;
  groups: MobileGroupDefinition[];
  allowGroups: boolean;
  onChange: (steps: MobileStep[]) => void;
}
export default function MobileStepsEditor({
  steps,
  platform,
  groups,
  allowGroups,
  onChange,
}: Props) {
  const { t } = useTranslation();
  const update = (index: number, patch: Partial<MobileStep>) =>
    onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  const move = (index: number, by: number) => {
    const next = [...steps];
    const [step] = next.splice(index, 1);
    next.splice(index + by, 0, step);
    onChange(next);
  };
  const flow = analyseFlow(mobileFlowSteps(steps));
  const depths = flowDepths(mobileFlowSteps(steps));
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {steps.map((step, index) => {
          const spec = MOBILE_ACTIONS[step.action];
          const conditional = step.action === 'if' || step.action === 'repeatWhile';
          const problem = mobileStepProblem(step, platform);
          const unavailable =
            step.action === 'callGroup' &&
            step.value &&
            !groups.some((group) => group.id === step.value && group.platform === platform);
          return (
            <li
              key={step.id}
              className="rounded border p-2"
              style={{ marginLeft: Math.min(depths[index], 5) * 16 }}
              data-testid={`mobile-step-${index}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-5 text-xs text-muted-foreground">{index + 1}.</span>
                <Select
                  value={step.action}
                  onValueChange={(value) => update(index, { action: value as MobileActionId })}
                >
                  <SelectTrigger
                    className="w-48"
                    aria-label={t('mobileTests.actionOf', `Action of step ${index + 1}`, {
                      n: index + 1,
                    })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOBILE_ACTION_IDS.filter((id) => allowGroups || id !== 'callGroup').map(
                      (id) => (
                        <SelectItem key={id} value={id}>
                          {t(`mobileTests.actions.${id}`, labels[id])}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                {(spec.target || conditional) && (
                  <Input
                    className="flex-1 min-w-[180px] font-mono text-xs"
                    value={step.target ?? ''}
                    placeholder={
                      conditional
                        ? t('mobileTests.flow.optionalElement', 'Optional native element')
                        : '~login'
                    }
                    onChange={(e) => update(index, { target: e.target.value })}
                    aria-label={t('mobileTests.targetOf', `Element of step ${index + 1}`, {
                      n: index + 1,
                    })}
                  />
                )}
                {step.action === 'callGroup' ? (
                  <select
                    className="rounded border bg-background p-2 text-sm"
                    value={step.value ?? ''}
                    onChange={(e) => update(index, { value: e.target.value })}
                    aria-label={t('mobileTests.flow.groupOf', `Group of step ${index + 1}`, {
                      n: index + 1,
                    })}
                  >
                    <option value="">
                      {t('mobileTests.flow.chooseGroup', 'Choose a mobile group')}
                    </option>
                    {unavailable && (
                      <option value={step.value}>
                        {t('mobileTests.flow.unavailableGroup', 'Unavailable group')}
                      </option>
                    )}
                    {groups
                      .filter((group) => group.platform === platform)
                      .map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  spec.value && (
                    <Input
                      className="w-48"
                      value={step.value ?? ''}
                      placeholder={
                        conditional
                          ? 'visible / {{status}} == Paid'
                          : step.action === 'repeat'
                            ? '2'
                            : undefined
                      }
                      onChange={(e) => update(index, { value: e.target.value })}
                      aria-label={t('mobileTests.valueOf', `Value of step ${index + 1}`, {
                        n: index + 1,
                      })}
                    />
                  )
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={t('mobileTests.moveUp', `Move step ${index + 1} up`, {
                    n: index + 1,
                  })}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={index === steps.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={t('mobileTests.moveDown', `Move step ${index + 1} down`, {
                    n: index + 1,
                  })}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange(steps.filter((_, i) => i !== index))}
                  aria-label={t('mobileTests.removeStep', `Remove step ${index + 1}`, {
                    n: index + 1,
                  })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {(problem || unavailable) && (
                <p className="mt-1 text-xs text-destructive">
                  {problem ?? t('mobileTests.flow.unavailableGroup', 'Unavailable group')}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {!flow.ok &&
        flow.errors.map((error) => (
          <p key={error} className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([...steps, { id: crypto.randomUUID(), action: 'tap', target: '', value: '' }])
        }
      >
        <Plus className="mr-1 h-4 w-4" />
        {t('mobileTests.addStep', 'Add step')}
      </Button>
    </div>
  );
}
