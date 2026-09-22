import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Wand2, Image as ImageIcon } from 'lucide-react';

/**
 * What a test actually did, step by step.
 *
 * The runner has recorded this for every UI test since there were reports — status, detail,
 * error, a screenshot per step, and now the three images of a visual comparison — and the
 * report displayed none of it: the button that should open it was labelled "(Placeholder)"
 * and did nothing, so the only account of a failure was the one-line reason on the row.
 */

export interface ReportStepVisual {
  outcome: string;
  detail: string;
  diffRatio?: number;
  baselineImage?: string | null;
  actualImage?: string | null;
  diffImage?: string | null;
}

export interface ReportStep {
  name: string;
  type: string;
  status: 'passed' | 'failed';
  details: string;
  error?: string;
  healed?: boolean;
  rca?: string;
  screenshot?: string | null;
  visual?: ReportStepVisual;
}

interface StepDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testName: string;
  browser?: string | null;
  steps: ReportStep[];
}

/** The picture and what it is a picture of, since three unlabelled images say nothing. */
function ImagePanel({ label, src }: { label: string; src?: string | null }) {
  if (!src) return null;
  return (
    <figure className="min-w-0 flex-1">
      <figcaption className="text-xs text-muted-foreground mb-1">{label}</figcaption>
      <a href={src} target="_blank" rel="noreferrer" title={`Open ${label.toLowerCase()} full size`}>
        <img src={src} alt={label} className="w-full rounded border dark:border-slate-700 bg-muted" loading="lazy" />
      </a>
    </figure>
  );
}

function VisualPanel({ visual }: { visual: ReportStepVisual }) {
  const isDiff = visual.outcome === 'diff';
  return (
    <div className={`mt-3 rounded-md border p-3 ${isDiff ? 'border-destructive/60' : 'dark:border-slate-700'}`}>
      <div className="flex items-center gap-2 mb-2">
        <ImageIcon className="h-4 w-4" />
        <span className="text-sm font-medium">Visual check</span>
        <Badge variant={isDiff ? 'destructive' : 'secondary'} className="whitespace-nowrap">
          {visual.outcome}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{visual.detail}</p>
      {(visual.baselineImage || visual.actualImage || visual.diffImage) && (
        <div className="flex flex-col sm:flex-row gap-3 mt-3">
          <ImagePanel label="Baseline" src={visual.baselineImage} />
          <ImagePanel label="This run" src={visual.actualImage} />
          <ImagePanel label="Difference" src={visual.diffImage} />
        </div>
      )}
    </div>
  );
}

const StepDetailsDialog: React.FC<StepDetailsDialogProps> = ({ open, onOpenChange, testName, browser, steps }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{testName}</DialogTitle>
          <DialogDescription>
            {browser ? `Steps recorded on ${browser}.` : 'Steps recorded during this run.'}
          </DialogDescription>
        </DialogHeader>

        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">
            This result has no recorded steps. API tests and tests blocked by a precondition
            never reach the step runner.
          </p>
        ) : (
          <ScrollArea className="flex-1 pr-3">
            <ol className="space-y-3">
              {steps.map((step, index) => (
                <li
                  key={`${step.name}-${index}`}
                  className={`rounded-md border p-3 ${step.status === 'failed' ? 'border-destructive' : 'dark:border-slate-700'}`}
                >
                  <div className="flex items-start gap-2">
                    {step.status === 'failed' ? (
                      <XCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          {index + 1}. {step.name}
                        </span>
                        <Badge variant="outline" className="whitespace-nowrap text-xs">
                          {step.type}
                        </Badge>
                        {step.healed && (
                          <Badge variant="secondary" className="whitespace-nowrap text-xs">
                            <Wand2 className="h-3 w-3 mr-1" /> healed
                          </Badge>
                        )}
                      </div>
                      <p className={`text-xs mt-1 ${step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {step.error || step.details}
                      </p>
                      {step.rca && <p className="text-xs mt-1 italic text-muted-foreground">{step.rca}</p>}
                    </div>
                  </div>

                  {step.visual && <VisualPanel visual={step.visual} />}

                  {/* The step's own screenshot comes last, and not at all when a visual
                      comparison already showed this run's page beside its baseline. */}
                  {step.screenshot && !step.visual?.actualImage && (
                    <div className="mt-3">
                      <ImagePanel label="Screenshot" src={step.screenshot} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default StepDetailsDialog;
