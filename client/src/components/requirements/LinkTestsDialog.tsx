import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

/**
 * The tests that cover a requirement: web, API and mobile app tests alike.
 *
 * A linked test in a project the requester cannot see is not listed, and saving leaves it linked:
 * the server keeps what the requester cannot see, and the dialog says it is there.
 */

export interface LinkedTest {
  type: 'ui' | 'api' | 'mobile';
  id: number;
  /** Null for a test in a project the requester cannot see. */
  name: string | null;
}

interface NamedRow {
  id: number;
  name: string;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return response.json();
}

const keyOf = (type: 'ui' | 'api' | 'mobile', id: number) => `${type}:${id}`;

interface Props {
  isOpen: boolean;
  requirement: { key: string; title: string; tests: LinkedTest[] } | null;
  saving: boolean;
  onClose: () => void;
  onSave: (items: Array<{ type: 'ui' | 'api' | 'mobile'; id: number }>) => void;
}

export default function LinkTestsDialog({ isOpen, requirement, saving, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!isOpen || !requirement) return;
    setPicked(requirement.tests.filter((test) => test.name !== null).map((test) => keyOf(test.type, test.id)));
    setFilter('');
  }, [isOpen, requirement]);

  const { data: uiTests = [] } = useQuery<NamedRow[]>({ queryKey: ['/api/tests'], queryFn: () => getJson('/api/tests'), enabled: isOpen });
  const { data: apiTests = [] } = useQuery<NamedRow[]>({ queryKey: ['apiTests'], queryFn: () => getJson('/api/api-tests'), enabled: isOpen });
  const { data: mobileTests = [] } = useQuery<NamedRow[]>({ queryKey: ['mobileTests'], queryFn: () => getJson('/api/mobile-tests'), enabled: isOpen });

  const candidates = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = [
      ...(Array.isArray(uiTests) ? uiTests : []).map((test) => ({ type: 'ui' as const, id: test.id, name: test.name })),
      ...(Array.isArray(apiTests) ? apiTests : []).map((test) => ({ type: 'api' as const, id: test.id, name: test.name })),
      ...(Array.isArray(mobileTests) ? mobileTests : []).map((test) => ({ type: 'mobile' as const, id: test.id, name: test.name })),
    ];
    return needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows;
  }, [uiTests, apiTests, mobileTests, filter]);

  const hidden = requirement?.tests.filter((test) => test.name === null).length ?? 0;
  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((v) => v !== id) : [...current, id]));

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('requirements.link.title', 'Tests covering {{key}}', { key: requirement?.key ?? '' })}
          </DialogTitle>
          <DialogDescription>{requirement?.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input placeholder={t('requirements.link.filter', 'Filter tests…')} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('requirements.link.filter', 'Filter tests…')} />
          <div className="max-h-72 overflow-y-auto rounded border p-2 space-y-1" data-testid="requirement-test-list">
            {candidates.length === 0 && <p className="text-sm text-muted-foreground">{t('requirements.link.none', 'No tests.')}</p>}
            {candidates.map((test) => {
              const id = keyOf(test.type, test.id);
              return (
                <label key={id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={picked.includes(id)} onCheckedChange={() => toggle(id)} aria-label={test.name} />
                  <span className="flex-1">{test.name}</span>
                  <Badge variant="outline">{test.type === 'ui' ? t('requirements.web', 'Web') : test.type === 'mobile' ? t('requirements.mobile', 'Mobile') : 'API'}</Badge>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t('requirements.link.picked', '{{count}} selected', { count: picked.length })}</p>
          {hidden > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="requirement-hidden-tests">
              {t('requirements.link.hidden', '{{count}} more linked tests are in projects you cannot see; they stay linked.', { count: hidden })}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('requirements.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={() =>
              onSave(
                picked.map((entry) => {
                  const [type, id] = entry.split(':');
                  return { type: type as 'ui' | 'api' | 'mobile', id: Number(id) };
                }),
              )
            }
            disabled={saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('requirements.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
