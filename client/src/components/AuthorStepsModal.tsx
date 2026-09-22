import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Check, Loader2, Wand2 } from 'lucide-react';
import type { TestStep } from '@/components/drag-drop-provider';

/**
 * Writing the test by describing it.
 *
 * A test could only start from somebody clicking through the application, by hand or in front
 * of the recorder — even though the description already exists in the ticket that asked for it.
 *
 * Nothing here is inserted until it has been read: every line comes back either as a step, shown
 * with the action and the element it resolved to, or as a line that could not be read, with the
 * reason. That is the point of the preview. A sentence understood the wrong way becomes a test
 * that passes for a reason nobody intended, and the only moment anyone can catch that is before
 * the steps are in the builder.
 */

export interface AuthoredStep {
  line: number;
  text: string;
  source: 'pattern' | 'model';
  step: TestStep;
}

interface UnresolvedLine {
  line: number;
  text: string;
  reason: string;
}

interface AuthoringResponse {
  steps: AuthoredStep[];
  unresolved: UnresolvedLine[];
  usedModel: boolean;
  modelAvailable: boolean;
  catalogue: { repository: string[]; detected: number };
}

interface Project {
  id: number;
  name: string;
}

interface AuthorStepsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** What the builder found on the page it is looking at. A sentence may only name these. */
  elements: unknown[];
  onInsert: (steps: TestStep[]) => void;
}

const NO_PROJECT = 'none';

/** What a proposed step did, in one line, without making the reader open anything. */
export function describeStep(step: TestStep, translate: (key: string, fallback: string) => string): string {
  const action = translate(step.action.name, step.action.id);
  const target = step.targetElement
    ? (step.targetElement.text || '').trim() || step.targetElement.selector
    : '';
  const value = step.value ? `"${step.value}"` : '';
  return [action, target, value].filter(Boolean).join(' · ');
}

const AuthorStepsModal: React.FC<AuthorStepsModalProps> = ({ isOpen, onClose, elements, onInsert }) => {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState<string>(NO_PROJECT);
  const [result, setResult] = useState<AuthoringResponse | null>(null);
  const [error, setError] = useState('');
  const [isReading, setIsReading] = useState(false);

  const { data: projects = [] } = useQuery<Project[], Error>({
    queryKey: ['projects'],
    queryFn: async () => {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error('Could not load projects');
      return response.json();
    },
    enabled: isOpen,
  });

  useEffect(() => {
    if (isOpen) return;
    // Cleared on close, not on open: a preview left on screen from the last test would be
    // inserted into this one by somebody who thought they were looking at their own sentences.
    setText('');
    setResult(null);
    setError('');
  }, [isOpen]);

  const handleRead = async () => {
    setError('');
    setResult(null);
    setIsReading(true);
    try {
      const response = await fetch('/api/authoring/steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          projectId: projectId === NO_PROJECT ? null : Number(projectId),
          elements,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not read those instructions');
      setResult(body as AuthoringResponse);
    } catch (readError: any) {
      setError(readError?.message ?? 'Could not read those instructions');
    } finally {
      setIsReading(false);
    }
  };

  const handleInsert = () => {
    if (!result || result.steps.length === 0) return;
    onInsert(result.steps.map((item) => item.step));
    onClose();
  };

  const safeProjects = Array.isArray(projects) ? projects : [];
  const steps = result?.steps ?? [];
  const unresolved = result?.unresolved ?? [];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Wand2 className="mr-2 h-5 w-5" />
            {t('authorSteps.title', 'Describe the test')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'authorSteps.description',
              'One instruction per line, in the words the ticket used. Every line is shown as the step it became before anything is inserted — a sentence read the wrong way would otherwise become a test that passes for the wrong reason.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="authorStepsText">{t('authorSteps.textLabel', 'What the test does')}</Label>
            <Textarea
              id="authorStepsText"
              data-testid="author-steps-text"
              rows={7}
              className="mt-1 font-mono text-sm"
              placeholder={t(
                'authorSteps.placeholder',
                'Go to https://example.com/login\nType "admin" into the Username field\nClick the Sign in button\nCheck that the dashboard is visible',
              )}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="authorStepsProject">
              {t('authorSteps.projectLabel', 'Project whose elements may be named (optional)')}
            </Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="authorStepsProject" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT}>
                  {t('authorSteps.noProject', 'Only what is detected on this page')}
                </SelectItem>
                {safeProjects.map((project) => (
                  <SelectItem key={project.id} value={String(project.id)}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {t(
                'authorSteps.projectHint',
                'A step that names a kept element reads its selector from the repository, so a later repair reaches this test too.',
              )}
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {result && (
            <div className="space-y-2 max-h-72 overflow-y-auto" data-testid="author-steps-preview">
              {steps.map((item) => (
                <div key={`step-${item.line}`} className="flex items-start gap-2 text-sm border rounded-md p-2">
                  <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate">{item.text}</p>
                    <p className="text-xs text-muted-foreground">
                      {describeStep(item.step, (key, fallback) => t(key, fallback))}
                    </p>
                  </div>
                  {item.source === 'model' && (
                    <Badge variant="secondary" className="ml-auto shrink-0">
                      {t('authorSteps.fromModel', 'AI')}
                    </Badge>
                  )}
                </div>
              ))}
              {unresolved.map((item) => (
                <div
                  key={`unresolved-${item.line}`}
                  className="flex items-start gap-2 text-sm border border-destructive/40 rounded-md p-2"
                >
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate">{item.text}</p>
                    <p className="text-xs text-destructive">{item.reason}</p>
                  </div>
                </div>
              ))}
              {!result.modelAvailable && unresolved.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t(
                    'authorSteps.noModel',
                    'No AI key is configured, so only the phrasings this understands on its own were read.',
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleRead} disabled={isReading || text.trim() === ''} variant="secondary">
            {isReading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('authorSteps.read', 'Read the description')}
          </Button>
          <Button onClick={handleInsert} disabled={steps.length === 0}>
            {t('authorSteps.insert', 'Insert {{count}} steps', { count: steps.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AuthorStepsModal;
