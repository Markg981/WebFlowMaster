import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Trash2, Copy, Plus, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { format } from 'date-fns';

interface WebhooksModalProps {
  isOpen: boolean;
  onClose: () => void;
  planId: string;
  planName: string;
}

interface WebhookSummary {
  id: number;
  name: string;
  /** The first characters of the token: enough to tell two apart, far too few to use. */
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * The CI webhooks of a plan.
 *
 * A token is shown once, right after it is created: the server keeps only its hash, so it cannot
 * be shown again. A lost token is replaced by deleting the webhook and creating another.
 */
export default function WebhooksModal({ isOpen, onClose, planId, planName }: WebhooksModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newWebhookName, setNewWebhookName] = useState('');
  /** The token just created, until the dialog is closed. Never fetched again. */
  const [justCreated, setJustCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: webhooks = [] } = useQuery<WebhookSummary[]>({
    queryKey: ['webhooks', planId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/test-plans/${planId}/webhooks`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: isOpen && !!planId,
  });

  const createWebhookMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/test-plans/${planId}/webhooks`, { name });
      return res.json() as Promise<WebhookSummary & { token: string }>;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', planId] });
      setNewWebhookName('');
      setJustCreated({ name: created.name, token: created.token });
    },
    onError: () => {
      toast({ title: 'Errore nella creazione del Webhook', variant: 'destructive' });
    }
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/webhooks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', planId] });
      toast({ title: 'Webhook eliminato' });
    }
  });

  const endpoint = `${window.location.origin}/api/webhooks/execute`;
  const copy = (what: 'token' | 'curl', text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
    toast({ title: what === 'token' ? 'Token copiato negli appunti' : 'Comando copiato negli appunti' });
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Gone for good once the dialog closes: nothing can show it again.
      setJustCreated(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Webhook CI/CD - {planName}</DialogTitle>
          <DialogDescription>
            Gestisci i webhook per lanciare questo Test Plan da GitHub Actions o altri sistemi CI/CD.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 items-center mt-4">
          <Input 
            placeholder="Nome Webhook (es. GitHub Actions Prod)" 
            value={newWebhookName}
            onChange={(e) => setNewWebhookName(e.target.value)}
          />
          <Button 
            onClick={() => createWebhookMutation.mutate(newWebhookName)}
            disabled={!newWebhookName || createWebhookMutation.isPending}
          >
            <Plus className="h-4 w-4 mr-2" />
            Crea
          </Button>
        </div>

        {justCreated && (
          <div className="mt-4 rounded-md border border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2" data-testid="new-webhook-token">
            <p className="text-sm font-medium">
              Token del webhook «{justCreated.name}»: copialo ora, non sarà più visibile.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate text-xs bg-muted p-2 rounded">{justCreated.token}</code>
              <Button variant="outline" size="sm" onClick={() => copy('token', justCreated.token)}>
                {copied === 'token' ? <Check className="h-3 w-3 mr-1 text-success" /> : <Copy className="h-3 w-3 mr-1" />}
                Token
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate text-xs bg-muted p-2 rounded">
                curl -X POST -H "X-Webhook-Token: $WFM_WEBHOOK_TOKEN" {endpoint}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy('curl', `curl -X POST -H "X-Webhook-Token: ${justCreated.token}" ${endpoint}`)}
              >
                {copied === 'curl' ? <Check className="h-3 w-3 mr-1 text-success" /> : <Copy className="h-3 w-3 mr-1" />}
                curl
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Mettilo tra i segreti della pipeline e invialo nell'header <code>X-Webhook-Token</code>: nell'URL finirebbe nei log dei proxy.
            </p>
          </div>
        )}

        <div className="mt-6 border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Ultimo Utilizzo</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-4">
                    Nessun webhook configurato.
                  </TableCell>
                </TableRow>
              )}
              {webhooks.map((wh) => (
                <TableRow key={wh.id}>
                  <TableCell className="font-medium">{wh.name}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted p-1 rounded" title="Il token completo è visibile solo alla creazione">
                      {wh.tokenPrefix}…
                    </code>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {wh.lastUsedAt ? format(new Date(wh.lastUsedAt), 'PPp') : 'Mai usato'}
                  </TableCell>
                  <TableCell>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-destructive"
                      onClick={() => deleteWebhookMutation.mutate(wh.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
