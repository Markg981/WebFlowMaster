import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiTest, Precondition } from '@shared/schema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/select';
import { ArrowUp, ArrowDown, Trash2, PlusCircle } from 'lucide-react';

interface PreconditionsPanelProps {
  preconditions: Precondition[];
  onChange: (next: Precondition[]) => void;
}

// Turn a saved API test into a precondition (an ordered setup call).
function apiTestToPrecondition(t: ApiTest): Precondition {
  return {
    id: `pc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: t.name,
    method: t.method,
    url: t.url,
    queryParams: Array.isArray(t.queryParams) ? (t.queryParams as any) : null,
    requestHeaders: (t.requestHeaders as Record<string, string> | null) ?? null,
    requestBody: (t.requestBody as any) ?? null,
    sourceApiTestId: t.id,
  };
}

export const PreconditionsPanel: React.FC<PreconditionsPanelProps> = ({ preconditions, onChange }) => {
  const { data: apiTests = [] } = useQuery<ApiTest[]>({ queryKey: ['/api/api-tests'] });

  // Group the saved API tests by module for a readable picker.
  const byModule = new Map<string, ApiTest[]>();
  for (const t of apiTests) {
    const m = t.module || 'Other';
    if (!byModule.has(m)) byModule.set(m, []);
    byModule.get(m)!.push(t);
  }

  const add = (apiTestId: string) => {
    const t = apiTests.find((x) => String(x.id) === apiTestId);
    if (t) onChange([...preconditions, apiTestToPrecondition(t)]);
  };
  const remove = (id: string) => onChange(preconditions.filter((p) => p.id !== id));
  const move = (index: number, delta: number) => {
    const next = [...preconditions];
    const j = index + delta;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="py-3 px-4 border-b">
        <CardTitle className="text-base flex items-center gap-2">
          Preconditions
          <Badge variant="outline" className="text-xs">{preconditions.length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          API setup calls run in order (through the app under test) before the UI sequence.
        </p>
      </CardHeader>
      <CardContent className="p-3 flex-1 space-y-3">
        <Select onValueChange={add} value="">
          <SelectTrigger className="h-9">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <PlusCircle className="h-4 w-4" /> Add a saved API test as setup…
            </span>
          </SelectTrigger>
          <SelectContent>
            {Array.from(byModule.keys()).sort().map((mod) => (
              <SelectGroup key={mod}>
                <SelectLabel>{mod}</SelectLabel>
                {byModule.get(mod)!.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    <span className="font-mono text-xs mr-2">{t.method}</span>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>

        {preconditions.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No preconditions. The test will run against the current app state.
          </p>
        ) : (
          <ol className="space-y-2">
            {preconditions.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2 p-2 border rounded-md">
                <span className="text-xs text-muted-foreground w-5 text-center">{i + 1}</span>
                <Badge variant="secondary" className="font-mono text-xs">{p.method}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" title={p.name}>{p.name}</div>
                  <div className="text-xs text-muted-foreground truncate" title={p.url}>{p.url}</div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, 1)} disabled={i === preconditions.length - 1}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(p.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
};
