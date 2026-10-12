import { PageHeader } from '@/components/layout/PageHeader';
import { SettingsLayout, type SettingsSection } from '@/components/layout/SettingsLayout';
import { useAuth } from '@/hooks/use-auth';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';

import { useTranslation } from 'react-i18next';
import {
  Sun,
  Bell,
  User,
  Loader2,
  ListTree,
  Archive,
  KeyRound,
  KeySquare,
  Gauge,
  Crosshair,
  Puzzle,
  Bug,
  SlidersHorizontal,
  ScrollText,
  DatabaseBackup,
  ShieldCheck,
  Server,
  Users,
  Laptop,
  GitCommitHorizontal,
  Cloud,
  ClipboardList,
  GitBranch,
  MessageSquareText,
  Tag,
  CreditCard,
} from 'lucide-react';

import EnvironmentsCard from '@/components/settings/EnvironmentsCard';
import ProjectsCard from '@/components/settings/ProjectsCard';
import SystemSettingsCard from '@/components/settings/SystemSettingsCard';
import {
  NotificationsCard,
  PreferencesCards,
  TestDefaultsCards,
  UserSettingsFooter,
} from '@/components/settings/UserSettingsSections';
import { useUserSettingsForm } from '@/hooks/use-user-settings-form';
import ApiKeysCard from '@/components/settings/ApiKeysCard';
import ServiceAccountsCard from '@/components/settings/ServiceAccountsCard';
import MembersCard from '@/components/settings/MembersCard';
import ChangePasswordCard from '@/components/settings/ChangePasswordCard';
import AgentsCard from '@/components/settings/AgentsCard';
import SourceHostsCard from '@/components/settings/SourceHostsCard';
import RunUsageCard from '@/components/settings/RunUsageCard';
import QuotaAdministrationCard from '@/components/settings/QuotaAdministrationCard';
import BillingCard from '@/components/settings/BillingCard';
import BillingAdministrationCard from '@/components/settings/BillingAdministrationCard';
import AuditLogCard from '@/components/settings/AuditLogCard';
import ExportEraseCard from '@/components/settings/ExportEraseCard';
import SecurityCard from '@/components/settings/SecurityCard';
import SsoCard from '@/components/settings/SsoCard';
import EmailProviderCard from '@/components/settings/EmailProviderCard';
import EmailTemplatesCard from '@/components/settings/EmailTemplatesCard';
import EmailDeliveryCard from '@/components/settings/EmailDeliveryCard';
import RunnersCard from '@/components/settings/RunnersCard';
import ElementRepositoryCard from '@/components/settings/ElementRepositoryCard';
import CustomActionsCard from '@/components/settings/CustomActionsCard';
import TagsCard from '@/components/settings/TagsCard';
import ImpactMapCard from '@/components/settings/ImpactMapCard';
import SmsInboxCard from '@/components/settings/SmsInboxCard';
import IssueTrackersCard from '@/components/settings/IssueTrackersCard';
import BrowserGridsCard from '@/components/settings/BrowserGridsCard';
import TestManagementCard from '@/components/settings/TestManagementCard';
import BddProfilesCard from '@/components/settings/BddProfilesCard';

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, logoutMutation } = useAuth();
  // Installation-wide settings (log level and retention, runners) belong to the installation's
  // administrators (server/tenancy/installation-admin.ts). Unknown, from an older server, means yes.
  const canManageInstallation = user?.installationAdmin ?? true;
  const queryClient = useQueryClient();
  const form = useUserSettingsForm();
  const isPageDisabled = form.settings.isLoading || form.isSaving || logoutMutation.isPending;

  if (form.settings.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="ml-4 text-lg text-muted-foreground">
          {t('settingsPage.loadingSettings.text')}
        </p>
      </div>
    );
  }

  if (form.settings.isError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <Bell className="h-10 w-10 text-destructive" />
        <p className="mt-4 text-lg font-semibold text-destructive">
          {t('settingsPage.errorLoadingUserSettings.label')}
        </p>
        <p className="text-sm text-muted-foreground">
          {form.settings.error?.message || t('settingsPage.anUnknownErrorOccurred.description')}
        </p>
        <Button
          onClick={() => queryClient.refetchQueries({ queryKey: ['settings'] })}
          className="mt-4"
        >
          {t('settingsPage.tryAgain.button')}
        </Button>
      </div>
    );
  }

  const userSettingsFooter = <UserSettingsFooter form={form} disabled={isPageDisabled} />;

  const sections: SettingsSection[] = [
    {
      id: 'preferences',
      label: t('settings.sections.preferences'),
      description: t('settings.sections.preferencesDescription'),
      icon: Sun,
      footer: userSettingsFooter,
      content: <PreferencesCards form={form} disabled={isPageDisabled} />,
    },
    // Owners only: members, roles and invitations are an owner's to manage, and the server
    // answers anyone else with 403.
    ...(user?.role === 'owner'
      ? [
          {
            id: 'members',
            label: t('settings.sections.members', 'Members'),
            description: t(
              'settings.sections.membersDescription',
              'Who belongs to the organization, their roles, and invitations for new people.',
            ),
            icon: Users,
            content: <MembersCard />,
          },
        ]
      : []),
    {
      id: 'projects',
      label: t('settings.sections.projects'),
      description: t('settings.sections.projectsDescription'),
      icon: ListTree,
      content: <ProjectsCard />,
    },
    {
      id: 'environments',
      label: t('settings.sections.environments'),
      description: t('settings.sections.environmentsDescription', { token: '{{KEY_NAME}}' }),
      icon: KeyRound,
      content: <EnvironmentsCard />,
    },
    {
      id: 'elements',
      label: t('settings.sections.elements', 'Element repository'),
      description: t(
        'settings.sections.elementsDescription',
        'One definition per element of an application, so a moved button is corrected once rather than in every test that copied it.',
      ),
      icon: Crosshair,
      content: <ElementRepositoryCard />,
    },
    {
      id: 'customActions',
      label: t('settings.sections.customActions', 'Custom actions'),
      description: t(
        'settings.sections.customActionsDescription',
        'Steps of your own, in JavaScript that runs in the page under test, offered in the builder beside the built-in ones.',
      ),
      icon: Puzzle,
      content: <CustomActionsCard />,
    },
    // Editors and owners: renaming and deleting tags are theirs (the server answers a viewer
    // with 403), and a viewer sees the tags on every test already.
    ...(user?.role !== 'viewer'
      ? [
          {
            id: 'tags',
            label: t('settings.sections.tags', 'Tags'),
            description: t(
              'settings.sections.tagsDescription',
              'The words tests are filed under. Rename one and every test follows; delete one and it comes off every test.',
            ),
            icon: Tag,
            content: <TagsCard />,
          },
        ]
      : []),
    {
      id: 'impactMap',
      label: t('settings.sections.impactMap', 'Impact map'),
      description: t(
        'settings.sections.impactMapDescription',
        'Which files affect which tests, so a pipeline runs the tests a commit affects instead of all of them.',
      ),
      icon: GitBranch,
      content: <ImpactMapCard />,
    },
    ...(user?.role !== 'viewer'
      ? [
          {
            id: 'smsInbox',
            label: t('settings.sections.smsInbox', 'SMS inbox'),
            description: t(
              'settings.sections.smsInboxDescription',
              'Text messages your test numbers receive, for steps that wait for a code sent by SMS.',
            ),
            icon: MessageSquareText,
            content: <SmsInboxCard isOwner={user?.role === 'owner'} />,
          },
        ]
      : []),
    {
      id: 'issueTrackers',
      label: t('settings.sections.issueTrackers', 'Issue trackers'),
      description: t(
        'settings.sections.issueTrackersDescription',
        'Where a failing test becomes somebody’s ticket, in Jira or Azure DevOps.',
      ),
      icon: Bug,
      content: <IssueTrackersCard />,
    },
    {
      id: 'testManagement',
      label: t('settings.sections.testManagement', 'Test management'),
      description: t(
        'settings.sections.testManagementDescription',
        'TestRail, Xray or Zephyr Scale, where each finished run is published case by case.',
      ),
      icon: ClipboardList,
      content: <TestManagementCard />,
    },
    {
      id: 'browserGrids',
      label: t('settings.sections.browserGrids', 'Browser grids'),
      description: t(
        'settings.sections.browserGridsDescription',
        'BrowserStack, LambdaTest or a Playwright server of your own, for browsers and systems the runners do not have.',
      ),
      icon: Cloud,
      content: <BrowserGridsCard />,
    },
    {
      id: 'apiKeys',
      label: t('settings.sections.apiKeys', 'API keys'),
      description: t(
        'settings.sections.apiKeysDescription',
        'Credentials for pipelines and scripts, so CI never needs somebody’s password.',
      ),
      icon: KeySquare,
      content: (
        <>
          <ApiKeysCard isOwner={user?.role === 'owner'} />
          {user?.role === 'owner' && <ServiceAccountsCard />}
        </>
      ),
    },
    {
      id: 'sourceHosts',
      label: t('settings.sections.sourceHosts', 'GitHub & GitLab'),
      description: t(
        'settings.sections.sourceHostsDescription',
        'Runs started from a pipeline report pending, passed or failed on the commit they tested.',
      ),
      icon: GitCommitHorizontal,
      content: <SourceHostsCard isOwner={user?.role === 'owner'} />,
    },
    // Owners only: an agent is a machine an owner registers and revokes; a plan names its pool
    // in its own settings.
    ...(user?.role === 'owner'
      ? [
          {
            id: 'agents',
            label: t('settings.sections.agents', 'Local agents'),
            description: t(
              'settings.sections.agentsDescription',
              'Machines inside your network that lend their browsers, for applications this server cannot reach.',
            ),
            icon: Laptop,
            content: (
              <>
                <AgentsCard isOwner />
                <BddProfilesCard />
              </>
            ),
          },
        ]
      : []),
    {
      id: 'security',
      label: t('settings.sections.security', 'Security'),
      description: t(
        'settings.sections.securityDescription',
        'Your second factor at sign-in, and whether the organization requires one.',
      ),
      icon: ShieldCheck,
      content: (
        <div className="space-y-6">
          <SecurityCard isOwner={user?.role === 'owner'} />
          {user?.role === 'owner' && <SsoCard />}
          {user?.role === 'owner' && (
            <>
              <EmailProviderCard />
              <EmailTemplatesCard />
              <EmailDeliveryCard />
            </>
          )}
        </div>
      ),
    },
    {
      id: 'runUsage',
      label: t('settings.sections.runUsage', 'Run usage'),
      description: t(
        'settings.sections.runUsageDescription',
        'How many runs this organization has going and waiting, against its limits.',
      ),
      icon: Gauge,
      content: (
        <div className="space-y-6">
          <RunUsageCard />
          {user?.installationAdmin === true && <QuotaAdministrationCard />}
        </div>
      ),
    },
    // Owners only: the plan is the organization's to pay for; everybody else sees the banner.
    ...(user?.role === 'owner'
      ? [
          {
            id: 'billing',
            label: t('settings.sections.billing', 'Billing'),
            description: t(
              'settings.sections.billingDescription',
              'The plan this organization is on, where its subscription stands, and what it uses of what the plan includes.',
            ),
            icon: CreditCard,
            content: (
              <div className="space-y-6">
                <BillingCard />
                {user?.installationAdmin === true && <BillingAdministrationCard />}
              </div>
            ),
          },
        ]
      : []),
    // Owners only, like system settings: a runner serves the whole installation.
    ...(user?.role === 'owner'
      ? [
          {
            id: 'runners',
            label: t('settings.sections.runners', 'Runners'),
            description: t(
              'settings.sections.runnersDescription',
              'The machines that run plans: which are up, what they have, and draining one before maintenance.',
            ),
            icon: Server,
            content: <RunnersCard canManage={canManageInstallation} />,
          },
        ]
      : []),
    // Owners only: the trail names who did what, which the server shows no one else either.
    ...(user?.role === 'owner'
      ? [
          {
            id: 'auditLog',
            label: t('settings.sections.auditLog', 'Audit log'),
            description: t(
              'settings.sections.auditLogDescription',
              'Who changed what, when, from where, and whether through an API key.',
            ),
            icon: ScrollText,
            content: <AuditLogCard />,
          },
          {
            id: 'organizationData',
            label: t('settings.sections.organizationData', 'Export and erasure'),
            description: t(
              'settings.sections.organizationDataDescription',
              "Take the organization's data with you, or erase it for good.",
            ),
            icon: DatabaseBackup,
            content: <ExportEraseCard />,
          },
        ]
      : []),
    {
      id: 'defaults',
      label: t('settings.sections.defaults'),
      description: t('settings.sections.defaultsDescription'),
      icon: SlidersHorizontal,
      footer: userSettingsFooter,
      content: <TestDefaultsCards form={form} disabled={isPageDisabled} />,
    },
    // Owners only: log retention and log level apply to the whole installation.
    ...(user?.role === 'owner'
      ? [
          {
            id: 'system',
            label: t('settings.sections.system'),
            description: t('settings.sections.systemDescription'),
            icon: Archive,
            content: <SystemSettingsCard canManageInstallation={canManageInstallation} />,
          },
        ]
      : []),
    {
      id: 'notifications',
      label: t('settings.sections.notifications'),
      description: t('settings.sections.notificationsDescription'),
      icon: Bell,
      content: <NotificationsCard form={form} disabled={isPageDisabled} />,
    },
    {
      id: 'account',
      label: t('settings.sections.account'),
      description: t('settings.sections.accountDescription'),
      icon: User,
      // A "Delete account" button used to sit here that did nothing. Removing a person is an
      // owner's act, in Members, where what they made is handed on.
      content: <ChangePasswordCard />,
    },
  ];

  return (
    <SettingsLayout
      sections={sections}
      navLabel={t('settings.sections.navLabel')}
      header={
        <PageHeader
          title={t('settings.pageTitle', 'Settings')}
          description={t('settingsPage.description')}
        />
      }
    />
  );
}
