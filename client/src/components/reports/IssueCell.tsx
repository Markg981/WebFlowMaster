import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bug, ExternalLink, Loader2 } from 'lucide-react';

/**
 * What this failure already is, on somebody's board.
 *
 * Reading a report and deciding a failure deserves a ticket used to mean opening Jira in
 * another tab and retyping the test name, the browser, the error and a link. The button does
 * that in one request; the link is what stops the next person doing it again tomorrow for the
 * same failure.
 *
 * A failure that already has an issue never offers to file one. That is the point: the count
 * beside the key says how many times it has happened since, which is the argument seven
 * separate issues could not make.
 */

export interface IssueLinkSummary {
  dedupeKey: string;
  testName: string;
  browser: string | null;
  issueKey: string;
  issueUrl: string;
  occurrences: number;
  resolvedAt: string | null;
}

interface IssueCellProps {
  link?: IssueLinkSummary;
  /** Absent while the run has no result row to file — nothing to point a tracker at. */
  onFile?: () => Promise<void>;
  disabled?: boolean;
}

const IssueCell: React.FC<IssueCellProps> = ({ link, onFile, disabled }) => {
  const { t } = useTranslation();
  const [isFiling, setIsFiling] = useState(false);
  const [error, setError] = useState('');

  if (link) {
    return (
      <a
        href={link.issueUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center text-xs underline hover:text-primary whitespace-nowrap"
        title={t('issues.openInTracker', 'Open in the tracker')}
      >
        {link.issueKey}
        {link.occurrences > 1 && (
          <Badge variant="secondary" className="ml-1 font-normal">
            ×{link.occurrences}
          </Badge>
        )}
        <ExternalLink className="ml-1 h-3 w-3" />
      </a>
    );
  }

  if (!onFile) return <span className="text-xs text-muted-foreground">—</span>;

  const file = async () => {
    setError('');
    setIsFiling(true);
    try {
      await onFile();
    } catch (fileError: any) {
      // The tracker's own words, not a status code: "no permission to create issues in SHOP"
      // is something the reader can act on.
      setError(fileError?.message ?? 'Could not file the issue');
    } finally {
      setIsFiling(false);
    }
  };

  return (
    <div className="whitespace-nowrap">
      <Button variant="ghost" size="sm" onClick={file} disabled={isFiling || disabled}>
        {isFiling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bug className="h-4 w-4 mr-1" />}
        {t('issues.file', 'File')}
      </Button>
      {error && <p className="text-xs text-destructive max-w-[16rem] whitespace-normal">{error}</p>}
    </div>
  );
};

export default IssueCell;
