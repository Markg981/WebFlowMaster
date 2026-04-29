import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
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

export default function WebhooksModal({ isOpen, onClose, planId, planName }: WebhooksModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newWebhookName, setNewWebhookName] = useState('');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const { data: webhooks = [], isLoading } = useQuery({
    queryKey: ['webhooks', planId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/test-plans/${planId}/webhooks`);
      return res.json();
    },
    enabled: isOpen && !!planId,
  });

  const createWebhookMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", `/api/test-plans/${planId}/webhooks`, { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', planId] });
      setNewWebhookName('');
      toast({ title: 'Webhook creato con successo' });
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

  const handleCopy = (token: string) => {
    const url = `${window.location.origin}/api/webhooks/execute/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
    toast({ title: 'URL copiato negli appunti' });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
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

        <div className="mt-6 border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>URL Endpoint</TableHead>
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
              {webhooks.map((wh: any) => (
                <TableRow key={wh.id}>
                  <TableCell className="font-medium">{wh.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 max-w-[200px]">
                      <code className="truncate text-xs bg-muted p-1 rounded">
                        /execute/{wh.token.substring(0, 8)}...
                      </code>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleCopy(wh.token)}>
                        {copiedToken === wh.token ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
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
