import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

/**
 * Setting a test aside. The reason is required: it is what whoever releases the test later needs
 * to know was wrong with it.
 */

interface QuarantineDialogProps {
  /** The test to quarantine; null keeps the dialog closed. */
  test: { type: 'ui' | 'api'; id: number } | null;
  testName: string;
  onClose: () => void;
}

export default function QuarantineDialog({ test, testName, onClose }: QuarantineDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (test) setReason('');
  }, [test]);

  const submit = async () => {
    if (!test) return;
    setSaving(true);
    try {
      const response = await fetch('/api/quarantine', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testType: test.type, testId: test.id, reason: reason.trim() }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `Request failed (${response.status})`);
      }
      await queryClient.invalidateQueries({ queryKey: ['flakyTests'] });
      await queryClient.invalidateQueries({ queryKey: ['quarantine'] });
      toast({ title: t('quarantine.done', '"{{name}}" is in quarantine', { name: testName }) });
      onClose();
    } catch (error) {
      toast({ variant: 'destructive', title: t('quarantine.failed', 'The test was not quarantined'), description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={test !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('quarantine.title', 'Quarantine "{{name}}"', { name: testName })}</DialogTitle>
          <DialogDescription>
            {t(
              'quarantine.explain',
              'It keeps running and its results are kept, so you can see when it is fixed. Its failures stop failing runs, stopping plans, filing issues and breaking pipelines until somebody releases it.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="quarantine-reason">{t('quarantine.reason', 'Why')}</Label>
          <Textarea
            id="quarantine-reason"
            rows={3}
            value={reason}
            maxLength={2000}
            placeholder={t('quarantine.reasonPlaceholder', 'e.g. times out waiting for the payment iframe about one night in three')}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('quarantine.cancel', 'Cancel')}
          </Button>
          <Button onClick={submit} disabled={saving || reason.trim().length === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('quarantine.confirm', 'Quarantine')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
