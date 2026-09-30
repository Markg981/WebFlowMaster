import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Copy, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import {
  ANALYSIS_LANGUAGES,
  readFailureAnalysis,
  type AnalysisLanguage,
  type FailureAnalysis,
} from '@shared/failure-analysis';

/**
 * The AI's reading of one failed result: its probable cause, the evidence, what to do next.
 *
 * Opening the dialog on a result that has an analysis shows it as kept; on one that has none it
 * asks for one. Asking again is a separate, deliberate click, since each one is a model call.
 */

export interface AnalysedResult {
  id: string;
  testName: string;
  browser: string | null;
  aiAnalysis?: FailureAnalysis | null;
}

const interfaceLanguage = (language: string | undefined): AnalysisLanguage => {
  const short = (language ?? 'en').slice(0, 2) as AnalysisLanguage;
  return ANALYSIS_LANGUAGES.includes(short) ? short : 'en';
};

export default function FailureAnalysisDialog({
  executionId,
  result,
  onOpenChange,
  onAnalysed,
}: {
  executionId: string;
  result: AnalysedResult | null;
  onOpenChange: (open: boolean) => void;
  onAnalysed: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [analysis, setAnalysis] = useState<FailureAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const analyse = async (refresh: boolean) => {
    if (!result) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/test-plan-executions/${executionId}/results/${result.id}/ai-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: interfaceLanguage(i18n.language), refresh }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t('failureAnalysis.failed', 'The analysis could not be made.'));
      setAnalysis(readFailureAnalysis(body.analysis));
      if (!body.cached) onAnalysed();
    } catch (analysisError: any) {
      setError(analysisError?.message ?? String(analysisError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCopied(false);
    setError(null);
    const kept = readFailureAnalysis(result?.aiAnalysis);
    setAnalysis(kept);
    if (result && !kept) void analyse(false);
    // Only a different result starts a new analysis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.id]);

  const copySelector = async () => {
    if (!analysis?.proposedSelector) return;
    try {
      await navigator.clipboard.writeText(analysis.proposedSelector);
      setCopied(true);
    } catch {
      // The selector is on screen to be copied by hand.
    }
  };

  return (
    <Dialog open={result !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t('failureAnalysis.title', 'AI failure analysis')}
          </DialogTitle>
          <DialogDescription>
            {result?.testName}
            {result?.browser ? ` · ${result.browser}` : ''}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('failureAnalysis.loading', 'Reading the steps, the errors and the requests…')}
          </p>
        )}
        {error && !loading && <p className="text-sm text-destructive" role="alert">{error}</p>}

        {analysis && !loading && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{t(`failureAnalysis.category.${analysis.category}`, analysis.category)}</Badge>
              <Badge variant="outline">
                {t('failureAnalysis.confidenceLabel', 'Confidence')}: {t(`failureAnalysis.confidence.${analysis.confidence}`, analysis.confidence)}
              </Badge>
              {analysis.failedStep !== null && (
                <Badge variant="secondary">{t('failureAnalysis.step', 'Step {{n}}', { n: analysis.failedStep })}</Badge>
              )}
            </div>
            <p className="font-medium">{analysis.summary}</p>
            {analysis.explanation && (
              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">{t('failureAnalysis.why', 'Why')}</h4>
                <p className="whitespace-pre-line">{analysis.explanation}</p>
              </div>
            )}
            {analysis.suggestion && (
              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">{t('failureAnalysis.next', 'What to do')}</h4>
                <p className="whitespace-pre-line">{analysis.suggestion}</p>
              </div>
            )}
            {analysis.proposedSelector && (
              <div>
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">{t('failureAnalysis.selector', 'Proposed selector')}</h4>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{analysis.proposedSelector}</code>
                  <Button variant="outline" size="sm" onClick={copySelector} aria-label={t('failureAnalysis.copy', 'Copy')}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t('failureAnalysis.byline', 'By {{model}}, asked by {{name}} on {{when}}.', {
                model: analysis.model,
                name: analysis.byUsername,
                when: new Date(analysis.at).toLocaleString(),
              })}{' '}
              {analysis.sawScreenshot ? t('failureAnalysis.withScreenshot', 'It saw the screenshot.') : t('failureAnalysis.noScreenshot', 'No screenshot was available.')}{' '}
              {t('failureAnalysis.caveat', 'It is a probable cause, not a verdict: check it against the steps.')}
            </p>
          </div>
        )}

        {!loading && result && (analysis || error) && (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => analyse(analysis !== null)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {analysis ? t('failureAnalysis.again', 'Analyse again') : t('failureAnalysis.retry', 'Try again')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
