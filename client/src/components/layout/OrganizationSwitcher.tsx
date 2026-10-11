import { useState } from 'react';
import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { Building2, Check, ChevronDown, Loader2 } from 'lucide-react';
import { useAuth, type SessionUser } from '@/hooks/use-auth';
import { apiRequest, errorMessage, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Moving between the organizations one belongs to (server/organization-memberships.ts).
 *
 * Shown only to a person with more than one: for everybody else the organization is simply where
 * they are. A switch starts a new session on the server and the whole client state with it — every
 * cached query is of the organization just left, so the cache is cleared rather than invalidated,
 * and the app goes back to the dashboard.
 */
export function OrganizationSwitcher() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [switchingTo, setSwitchingTo] = useState<number | null>(null);

  const organizations = user?.organizations ?? [];
  if (organizations.length < 2) return null;
  const current = organizations.find((o) => o.current);

  const switchTo = async (organizationId: number) => {
    if (organizationId === current?.id || switchingTo !== null) return;
    setSwitchingTo(organizationId);
    try {
      const res = await apiRequest('POST', '/api/organizations/switch', { organizationId });
      const switched = (await res.json()) as SessionUser;
      queryClient.clear();
      queryClient.setQueryData(['/api/user'], switched);
      navigate('/dashboard');
    } catch (error) {
      toast({
        title: t('organizationSwitcher.failed', 'Could not switch organization'),
        description: errorMessage(error as Error),
        variant: 'destructive',
      });
    } finally {
      setSwitchingTo(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex max-w-[14rem] items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t('organizationSwitcher.label', 'Switch organization')}
          data-testid="organization-switcher"
        >
          {switchingTo !== null ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Building2 className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate">{current?.name}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t('organizationSwitcher.yourOrganizations', 'Your organizations')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((organization) => (
          <DropdownMenuItem
            key={organization.id}
            className="flex cursor-pointer items-center justify-between gap-2"
            disabled={switchingTo !== null}
            onSelect={() => void switchTo(organization.id)}
            data-testid={`organization-option-${organization.id}`}
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{organization.name}</span>
              <span className="text-xs text-muted-foreground">
                {t(`settings.members.roles.${organization.role}`, organization.role)}
              </span>
            </span>
            {organization.current && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default OrganizationSwitcher;
