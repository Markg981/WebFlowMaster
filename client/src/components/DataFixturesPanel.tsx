import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DATA_FIXTURE_PARAM_TYPES,
  DataFixturesSchema,
  type DataFixture,
  type DataFixtureParam,
} from '@shared/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowDown, ArrowUp, PlusCircle, Trash2, X } from 'lucide-react';

/**
 * The data a UI test needs in the application's database, checked and created by script before
 * it runs (server/runtime/data-setup). Each fixture reads first with `check`; only when that finds
 * nothing, and the environment allows data setup, does `apply` run, in one transaction.
 *
 * Validated here with the same schema the server applies on save, so a placeholder inside quotes
 * or an undeclared parameter shows up while typing rather than as a 400 on save.
 */

interface DataFixturesPanelProps {
  fixtures: DataFixture[];
  onChange: (next: DataFixture[]) => void;
}

const newFixture = (index: number): DataFixture => ({
  id: `fx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: '',
  alias: `data${index + 1}`,
  connection: null,
  params: [],
  check: '',
  apply: '',
  outputs: [],
  timeoutMs: null,
});

/** The problems the server would refuse on save, by fixture index, in a reader's words. */
export function fixtureProblems(fixtures: DataFixture[]): Map<number, string[]> {
  const problems = new Map<number, string[]>();
  const parsed = DataFixturesSchema.safeParse(fixtures);
  if (parsed.success) return problems;
  for (const issue of parsed.error.issues) {
    const index = typeof issue.path[0] === 'number' ? issue.path[0] : -1;
    const field = issue.path.slice(1).join('.');
    const list = problems.get(index) ?? [];
    list.push(field ? `${field}: ${issue.message}` : issue.message);
    problems.set(index, list);
  }
  return problems;
}

export const DataFixturesPanel: React.FC<DataFixturesPanelProps> = ({ fixtures, onChange }) => {
  const { t } = useTranslation();
  const problems = useMemo(() => fixtureProblems(fixtures), [fixtures]);

  const update = (index: number, patch: Partial<DataFixture>) =>
    onChange(fixtures.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...fixtures];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    onChange(next);
  };
  const updateParam = (index: number, p: number, patch: Partial<DataFixtureParam>) =>
    update(index, {
      params: fixtures[index].params.map((param, i) => (i === p ? { ...param, ...patch } : param)),
    });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('dataFixtures.title')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('dataFixtures.description')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {fixtures.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('dataFixtures.empty')}</p>
        )}
        {problems.get(-1)?.map((p) => (
          <p key={p} className="text-xs text-destructive">
            {p}
          </p>
        ))}
        {fixtures.map((fixture, index) => {
          const fieldId = (name: string) => `fixture-${fixture.id}-${name}`;
          return (
            <div key={fixture.id} className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  {index + 1}. {fixture.name || t('dataFixtures.untitled')}
                </span>
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={t('dataFixtures.moveUp')}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={index === fixtures.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={t('dataFixtures.moveDown')}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange(fixtures.filter((_, i) => i !== index))}
                    aria-label={t('dataFixtures.remove')}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor={fieldId('name')}>{t('dataFixtures.name')}</Label>
                  <Input
                    id={fieldId('name')}
                    value={fixture.name}
                    placeholder={t('dataFixtures.namePlaceholder')}
                    onChange={(e) => update(index, { name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={fieldId('alias')}>{t('dataFixtures.alias')}</Label>
                  <Input
                    id={fieldId('alias')}
                    value={fixture.alias}
                    className="font-mono"
                    onChange={(e) => update(index, { alias: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={fieldId('connection')}>{t('dataFixtures.connection')}</Label>
                  <Input
                    id={fieldId('connection')}
                    value={fixture.connection ?? ''}
                    className="font-mono"
                    placeholder="db.url"
                    onChange={(e) => update(index, { connection: e.target.value.trim() || null })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t('dataFixtures.params')}</Label>
                {fixture.params.map((param, p) => (
                  <div key={p} className="flex items-center gap-2">
                    <Input
                      aria-label={t('dataFixtures.paramName')}
                      value={param.name}
                      className="w-40 font-mono"
                      placeholder="email"
                      onChange={(e) => updateParam(index, p, { name: e.target.value })}
                    />
                    <Select
                      value={param.type}
                      onValueChange={(type) =>
                        updateParam(index, p, { type: type as DataFixtureParam['type'] })
                      }
                    >
                      <SelectTrigger className="w-32" aria-label={t('dataFixtures.paramType')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DATA_FIXTURE_PARAM_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label={t('dataFixtures.paramValue')}
                      value={param.value}
                      className="flex-1 font-mono"
                      placeholder="{{$randomEmail}}"
                      onChange={(e) => updateParam(index, p, { value: e.target.value })}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('dataFixtures.removeParam')}
                      onClick={() =>
                        update(index, { params: fixture.params.filter((_, i) => i !== p) })
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    update(index, {
                      params: [...fixture.params, { name: '', type: 'string', value: '' }],
                    })
                  }
                >
                  <PlusCircle className="mr-2 h-4 w-4" />
                  {t('dataFixtures.addParam')}
                </Button>
              </div>

              <div className="space-y-1">
                <Label htmlFor={fieldId('check')}>{t('dataFixtures.check')}</Label>
                <Textarea
                  id={fieldId('check')}
                  value={fixture.check}
                  rows={3}
                  className="font-mono text-xs"
                  placeholder="SELECT id FROM customers WHERE email = {{params.email}}"
                  onChange={(e) => update(index, { check: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={fieldId('apply')}>{t('dataFixtures.apply')}</Label>
                <Textarea
                  id={fieldId('apply')}
                  value={fixture.apply}
                  rows={5}
                  className="font-mono text-xs"
                  placeholder={'INSERT INTO customers (email) VALUES ({{params.email}})\nGO\n…'}
                  onChange={(e) => update(index, { apply: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {t('dataFixtures.applyHint', {
                    param: '{{params.name}}',
                    variable: '{{variable}}',
                  })}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={fieldId('outputs')}>{t('dataFixtures.outputs')}</Label>
                  <Input
                    id={fieldId('outputs')}
                    value={fixture.outputs.join(', ')}
                    className="font-mono"
                    placeholder="id"
                    onChange={(e) =>
                      update(index, {
                        outputs: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('dataFixtures.outputsHint', {
                      example: `{{fx.${fixture.alias || 'alias'}.${fixture.outputs[0] || 'id'}}}`,
                    })}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={fieldId('timeout')}>{t('dataFixtures.timeout')}</Label>
                  <Input
                    id={fieldId('timeout')}
                    type="number"
                    min={1}
                    max={300}
                    value={fixture.timeoutMs ? fixture.timeoutMs / 1000 : ''}
                    placeholder="30"
                    onChange={(e) => {
                      const seconds = Number(e.target.value);
                      update(index, {
                        timeoutMs:
                          e.target.value && seconds > 0 ? Math.round(seconds * 1000) : null,
                      });
                    }}
                  />
                </div>
              </div>

              {problems.get(index)?.map((p) => (
                <p key={p} className="text-xs text-destructive">
                  {p}
                </p>
              ))}
            </div>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...fixtures, newFixture(fixtures.length)])}
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          {t('dataFixtures.add')}
        </Button>
      </CardContent>
    </Card>
  );
};
