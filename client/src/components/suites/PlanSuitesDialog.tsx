import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

/**
 * Which suites a plan includes. They run after the plan's own tests, in the order they were
 * ticked; a test that is in more than one runs once, where it first appears.
 */

interface SuiteOption {
  id: number;
  name: string;
  kind: 'static' | 'dynamic';
  testCount: number;
}

interface PlanSuitesDialogProps {
  plan: { id: string; name: string } | null;
  onClose: () => void;
}

export default function PlanSuitesDialog({ plan, onClose }: PlanSuitesDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: suites = [], isLoading: loadingSuites } = useQuery<SuiteOption[]>({
    queryKey: ['suites'],
    queryFn: async () => {
      const response = await fetch('/api/suites', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load the suites');
      return response.json();
    },
    enabled: plan !== null,
  });

  const { data: included, isLoading: loadingIncluded } = useQuery<Array<{ id: number }>>({
    queryKey: ['planSuites', plan?.id],
    queryFn: async () => {
      const response = await fetch(`/api/test-plans/${encodeURIComponent(plan!.id)}/suites`, { credentials: 'include' });
      if (!response.ok) throw new Error("Could not load the plan's suites");
      return response.json();
    },
    enabled: plan !== null,
  });

  useEffect(() => {
    if (included) setChosen(included.map((suite) => suite.id));
  }, [included]);

  const toggle = (id: number) => setChosen((current) => (current.includes(id) ? current.filter((v) => v !== id) : [...current, id]));

  const save = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/test-plans/${encodeURIComponent(plan.id)}/suites`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suiteIds: chosen }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `Request failed (${response.status})`);
      }
      await queryClient.invalidateQueries({ queryKey: ['planSuites', plan.id] });
      await queryClient.invalidateQueries({ queryKey: ['suites'] });
      toast({ title: t('planSuites.saved', 'Suites saved') });
      onClose();
    } catch (error) {
      toast({ variant: 'destructive', title: t('planSuites.saveFailed', 'The suites were not saved'), description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const loading = loadingSuites || loadingIncluded;
  const list = Array.isArray(suites) ? suites : [];

  return (
    <Dialog open={plan !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('planSuites.title', 'Suites in "{{name}}"', { name: plan?.name ?? '' })}</DialogTitle>
          <DialogDescription>
            {t('planSuites.description', "They run after the plan's own tests, in the order you tick them. A test in more than one runs once.")}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="plan-suites-empty">
            {t('planSuites.none', 'No suites yet.')}{' '}
            <Link href="/suites" className="underline">
              {t('planSuites.createOne', 'Create one')}
            </Link>
          </p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {list.map((suite) => {
              const order = chosen.indexOf(suite.id);
              return (
                <label key={suite.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={order >= 0} onCheckedChange={() => toggle(suite.id)} aria-label={suite.name} />
                  <span className="flex-1">{suite.name}</span>
                  <Badge variant="outline">{t(`suites.kind.${suite.kind}`, suite.kind === 'static' ? 'Static' : 'Dynamic')}</Badge>
                  <span className="text-xs text-muted-foreground w-16 text-right">
                    {t('planSuites.tests', '{{count}} tests', { count: suite.testCount })}
                  </span>
                  <span className="w-5 text-right text-xs font-medium">{order >= 0 ? order + 1 : ''}</span>
                </label>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('suites.cancel', 'Cancel')}
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('suites.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
