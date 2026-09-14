import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Key, Plus, Trash2, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

export default function EnvironmentsCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [newEnvName, setNewEnvName] = useState('');
  const [expandedEnv, setExpandedEnv] = useState<number | null>(null);
  const [newSecretKey, setNewSecretKey] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');

  // Queries
  const { data: environments = [], isLoading: isLoadingEnvs } = useQuery({
    queryKey: ['environments'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/environments');
      return res.json();
    }
  });

  const { data: secrets = [], isLoading: isLoadingSecrets } = useQuery({
    queryKey: ['secrets', expandedEnv],
    queryFn: async () => {
      if (!expandedEnv) return [];
      const res = await apiRequest('GET', `/api/environments/${expandedEnv}/secrets`);
      return res.json();
    },
    enabled: expandedEnv !== null
  });

  // Mutations
  const createEnvMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest('POST', '/api/environments', { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments'] });
      setNewEnvName('');
      toast({ title: t('environments.toast.created') });
    },
    onError: (error: any) => toast({ title: t('common.error'), description: error.message, variant: 'destructive' })
  });

  const deleteEnvMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest('DELETE', `/api/environments/${id}`);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['environments'] });
      if (expandedEnv === id) setExpandedEnv(null);
      toast({ title: t('environments.toast.deleted') });
    }
  });

  const createSecretMutation = useMutation({
    mutationFn: async (data: { envId: number, key: string, val: string }) => {
      const res = await apiRequest('POST', `/api/environments/${data.envId}/secrets`, {
        keyName: data.key,
        value: data.val
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets', expandedEnv] });
      setNewSecretKey('');
      setNewSecretValue('');
      toast({ title: t('environments.toast.secretSaved') });
    },
    onError: (error: any) => toast({ title: t('common.error'), description: error.message, variant: 'destructive' })
  });

  const deleteSecretMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest('DELETE', `/api/secrets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets', expandedEnv] });
      toast({ title: t('environments.toast.secretDeleted') });
    }
  });

  const handleAddEnv = () => {
    if (!newEnvName) return;
    createEnvMutation.mutate(newEnvName);
  };

  const handleAddSecret = (envId: number) => {
    if (!newSecretKey || !newSecretValue) return;
    createSecretMutation.mutate({ envId, key: newSecretKey, val: newSecretValue });
  };

  return (
    // No CardHeader: this card is the whole Environments section, and the section heading
    // above it already carries the name and the explanation. Repeating both inside the card
    // read as two different things stacked on each other.
    <Card>
      <CardContent className="space-y-6 pt-6">
        
        {/* Add Environment */}
        <div className="flex space-x-2">
          <Input 
            placeholder={t('environments.newEnvironmentPlaceholder')} 
            value={newEnvName} 
            onChange={e => setNewEnvName(e.target.value)} 
          />
          <Button onClick={handleAddEnv} disabled={createEnvMutation.isPending || !newEnvName}>
            {createEnvMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />} {t('environments.add')}
          </Button>
        </div>

        {/* Environments List */}
        {isLoadingEnvs ? (
          <div className="flex items-center space-x-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /><span>{t('environments.loading')}</span>
          </div>
        ) : environments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('environments.empty')}</p>
        ) : (
          <div className="space-y-4">
            {environments.map((env: any) => (
              <div key={env.id} className="border rounded-md overflow-hidden">
                {/* Env Header */}
                <div 
                  className={`flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors ${expandedEnv === env.id ? 'bg-muted/30 border-b' : ''}`}
                  onClick={() => setExpandedEnv(expandedEnv === env.id ? null : env.id)}
                >
                  <div className="flex items-center space-x-2">
                    {expandedEnv === env.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="font-semibold">{env.name}</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); deleteEnvMutation.mutate(env.id); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                
                {/* Secrets Panel */}
                {expandedEnv === env.id && (
                  <div className="p-4 bg-background/50 space-y-4">
                    {isLoadingSecrets ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : secrets.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-2">{t('environments.noSecrets')}</p>
                    ) : (
                      <div className="space-y-2">
                        {secrets.map((sec: any) => (
                          <div key={sec.id} className="flex justify-between items-center bg-card p-2 rounded border">
                            <div className="flex items-center space-x-2">
                              <Key className="h-4 w-4 text-muted-foreground" />
                              <span className="font-mono text-sm bg-muted px-1.5 rounded">{`{{${sec.keyName}}}`}</span>
                            </div>
                            <div className="flex items-center space-x-4">
                              <span className="text-xs text-muted-foreground">{t('environments.encrypted')}</span>
                              <Button variant="ghost" size="sm" onClick={() => deleteSecretMutation.mutate(sec.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Add Secret Form */}
                    <div className="flex items-end space-x-2 pt-2 border-t mt-4">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">{t('environments.keyNameLabel')}</Label>
                        <Input 
                          placeholder={t('environments.keyNamePlaceholder')} 
                          value={newSecretKey} 
                          onChange={e => setNewSecretKey(e.target.value.toUpperCase().replace(/\s+/g, '_'))} 
                          className="font-mono text-sm"
                        />
                      </div>
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">{t('environments.secretValueLabel')}</Label>
                        <Input 
                          type="password" 
                          placeholder={t('environments.secretValuePlaceholder')} 
                          value={newSecretValue} 
                          onChange={e => setNewSecretValue(e.target.value)} 
                        />
                      </div>
                      <Button onClick={() => handleAddSecret(env.id)} disabled={createSecretMutation.isPending || !newSecretKey || !newSecretValue}>
                        {t('environments.addSecret')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

