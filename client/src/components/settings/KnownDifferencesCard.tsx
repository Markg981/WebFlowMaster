import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import { useProjects } from '@/hooks/use-projects';
import { formatDateTime } from '@/lib/dates';
import {
  createKnownDifference,
  deleteKnownDifference,
  listKnownDifferences,
  type KnownDifferenceView,
} from '@/lib/api/comparisons';
import { endOfDay } from '@/components/comparisons/ReviewDialog';
import { DIFFERENCE_KINDS, type DifferenceKind } from '@shared/comparison';

/**
 * The differences an environment comparison expects: each says which kind of difference, on
 * which checkpoint and path, for one test, a project or the whole organization, and why. A
 * later comparison marks a difference one of them covers as known, and the test stays at
 * parity. They are added from a review, or here by hand; an expired one no longer applies.
 */

const PAGE_SIZE = 25;
const ORGANIZATION = 'organization';
export const KNOWN_DIFFERENCES_QUERY_KEY = ['comparisonKnownDifferences'] as const;

function Reach({ row }: { row: KnownDifferenceView }) {
  const { t } = useTranslation();
  if (row.uiTestId)
    return (
      <>
        {t('settings.knownDifferences.reachTest', 'Test “{{name}}”', {
          name: row.testName ?? row.uiTestId,
        })}
      </>
    );
  if (row.projectId)
    return (
      <>
        {t('settings.knownDifferences.reachProject', 'Project “{{name}}”', {
          name: row.projectName ?? row.projectId,
        })}
      </>
    );
  return <>{t('settings.knownDifferences.reachOrganization', 'Whole organization')}</>;
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { data: projects = [] } = useProjects();
  const [project, setProject] = useState(ORGANIZATION);
  const [kind, setKind] = useState<DifferenceKind>('text');
  const [checkpoint, setCheckpoint] = useState('');
  const [path, setPath] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [expires, setExpires] = useState('');
  const create = useMutation({
    mutationFn: () =>
      createKnownDifference({
        projectId: project === ORGANIZATION ? null : Number(project),
        kind,
        checkpointName: checkpoint.trim() || null,
        pathPattern: path.trim() || null,
        reason: reason.trim(),
        reference: reference.trim() || null,
        expiresAt: expires ? endOfDay(expires) : null,
      }),
    onSuccess: () => {
      toast({ title: t('settings.knownDifferences.created', 'Known difference added') });
      onDone();
    },
    onError: (error) =>
      toast({
        title: t('settings.knownDifferences.createFailed', 'The known difference was not added'),
        description: (error as Error).message,
        variant: 'destructive',
      }),
  });

  return (
    <form
      className="grid gap-3 md:grid-cols-2 border rounded p-3"
      data-testid="known-difference-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim()) create.mutate();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="kd-project">{t('settings.knownDifferences.reach', 'Applies to')}</Label>
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger
            id="kd-project"
            aria-label={t('settings.knownDifferences.reach', 'Applies to')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ORGANIZATION}>
              {t('settings.knownDifferences.reachOrganization', 'Whole organization')}
            </SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="kd-kind">{t('settings.knownDifferences.kind', 'Kind')}</Label>
        <Select value={kind} onValueChange={(value) => setKind(value as DifferenceKind)}>
          <SelectTrigger id="kd-kind" aria-label={t('settings.knownDifferences.kind', 'Kind')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIFFERENCE_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`comparisons.kinds.${k}`, k)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="kd-checkpoint">
          {t('settings.knownDifferences.checkpoint', 'Checkpoint (empty: any)')}
        </Label>
        <Input
          id="kd-checkpoint"
          maxLength={200}
          value={checkpoint}
          onChange={(e) => setCheckpoint(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="kd-path">{t('settings.knownDifferences.path', 'Path (empty: any)')}</Label>
        <Input
          id="kd-path"
          maxLength={500}
          value={path}
          placeholder="rows[*][3]"
          onChange={(e) => setPath(e.target.value)}
        />
      </div>
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor="kd-reason">
          {t('settings.knownDifferences.reason', 'Why it is expected')}
        </Label>
        <Textarea
          id="kd-reason"
          rows={2}
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="kd-reference">
          {t('settings.knownDifferences.reference', 'Reference (optional)')}
        </Label>
        <Input
          id="kd-reference"
          maxLength={500}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="kd-expires">
          {t('settings.knownDifferences.expires', 'Expires (optional)')}
        </Label>
        <Input
          id="kd-expires"
          type="date"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
        />
      </div>
      <div className="md:col-span-2 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button type="submit" disabled={!reason.trim() || create.isPending}>
          {create.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          {t('settings.knownDifferences.add', 'Add')}
        </Button>
      </div>
    </form>
  );
}

const KnownDifferencesCard: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<KnownDifferenceView | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: [...KNOWN_DIFFERENCES_QUERY_KEY, page],
    queryFn: () => listKnownDifferences({ page, pageSize: PAGE_SIZE }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: KNOWN_DIFFERENCES_QUERY_KEY });
  const remove = useMutation({
    mutationFn: (id: string) => deleteKnownDifference(id),
    onSuccess: () => {
      setRemoving(null);
      refresh();
      toast({ title: t('settings.knownDifferences.deleted', 'Known difference deleted') });
    },
    onError: (error) =>
      toast({
        title: t('settings.knownDifferences.deleteFailed', 'The known difference was not deleted'),
        description: (error as Error).message,
        variant: 'destructive',
      }),
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const now = Date.now();

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>{t('settings.knownDifferences.title', 'Known differences')}</CardTitle>
          <CardDescription>
            {t(
              'settings.knownDifferences.description',
              'Differences an environment comparison expects. A covered difference is marked as known and the test stays at parity.',
            )}
          </CardDescription>
        </div>
        {canEdit && !adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t('settings.knownDifferences.new', 'New')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && (
          <CreateForm
            onDone={() => {
              setAdding(false);
              refresh();
            }}
          />
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('comparisons.loading', 'Loading…')}</p>
        ) : isError || !data ? (
          <p className="text-sm text-destructive">
            {t('settings.knownDifferences.error', 'The known differences could not be loaded.')}
          </p>
        ) : data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'settings.knownDifferences.empty',
              'None yet. Accept a difference in a comparison report and choose to expect it.',
            )}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.knownDifferences.reach', 'Applies to')}</TableHead>
                <TableHead>{t('settings.knownDifferences.what', 'What')}</TableHead>
                <TableHead>{t('settings.knownDifferences.reason', 'Why it is expected')}</TableHead>
                <TableHead>{t('settings.knownDifferences.expiresColumn', 'Expires')}</TableHead>
                {canEdit && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => {
                const expired = row.expiresAt !== null && Date.parse(row.expiresAt) <= now;
                return (
                  <TableRow key={row.id} data-testid={`known-difference-${row.id}`}>
                    <TableCell className="text-xs">
                      <Reach row={row} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {t(`comparisons.kinds.${row.kind}`, row.kind)}
                      {row.checkpointName && ` “${row.checkpointName}”`}
                      {row.pathPattern && (
                        <code className="ml-1 text-muted-foreground">{row.pathPattern}</code>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.reason}
                      {row.reference && (
                        <span className="ml-1 text-muted-foreground">({row.reference})</span>
                      )}
                    </TableCell>
                    <TableCell className={`text-xs ${expired ? 'text-destructive' : ''}`}>
                      {row.expiresAt
                        ? expired
                          ? t('settings.knownDifferences.expired', 'Expired')
                          : formatDateTime(row.expiresAt)
                        : t('settings.knownDifferences.never', 'Never')}
                    </TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={t(
                            'settings.knownDifferences.delete',
                            'Delete known difference',
                          )}
                          onClick={() => setRemoving(row)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label={t('common.previousPage', 'Previous page')}
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft size={16} />
            </Button>
            <span>
              {page} / {pages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label={t('common.nextPage', 'Next page')}
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoving(null);
        }}
        title={t('settings.knownDifferences.deleteDialog.title', 'Delete this known difference?')}
        description={t(
          'settings.knownDifferences.deleteDialog.description',
          'Later comparisons report the differences it covered again. Comparisons already made keep their verdict.',
        )}
        confirmLabel={t('common.delete', 'Delete')}
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </Card>
  );
};

export default KnownDifferencesCard;
