import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWhatsNew } from '@/hooks/use-whats-new';

/** `code` in an entry, as the changelog writes it, without rendering any other markup. */
function EntryText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
          <code key={i} className="rounded bg-muted px-1 font-mono text-[0.85em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

/**
 * What changed in this installation, release by release, from the CHANGELOG.md it ships with.
 * Opening the page counts as having seen it, and clears the dot on the account menu.
 */
export default function WhatsNewPage() {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError, markSeen } = useWhatsNew();

  useEffect(() => {
    if (data?.stamp) markSeen();
  }, [data?.stamp, markSeen]);

  const dateFormat = new Intl.DateTimeFormat(i18n?.language, { dateStyle: 'long' });
  const releaseName = (version: string) =>
    version === 'Unreleased' ? t('whatsNew.unreleased', 'Latest changes') : version;

  return (
    <div className="max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
          {t('whatsNew.title', 'What’s new')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            'whatsNew.description',
            'What changed in this installation, newest first. Each change links to the pull request that made it.',
          )}
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">{t('whatsNew.loading', 'Loading…')}</p>
      )}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('whatsNew.loadFailed', 'The list of changes could not be loaded.')}
        </p>
      )}
      {data && data.releases.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t('whatsNew.empty', 'This installation has no list of changes.')}
        </p>
      )}

      {data?.releases.map((release) => (
        <Card key={release.version}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-baseline gap-x-3 text-lg">
              <h2>{releaseName(release.version)}</h2>
              {release.date && (
                <span className="text-sm font-normal text-muted-foreground">
                  {dateFormat.format(new Date(`${release.date}T00:00:00`))}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {release.sections.map((section) => (
              <section key={section.title} aria-label={section.title}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(`whatsNew.sections.${section.title.toLowerCase()}`, section.title)}
                </h3>
                <ul className="space-y-1.5 text-sm">
                  {section.entries.map((entry, i) => (
                    <li key={entry.pr ?? `n${i}`} className="flex gap-2">
                      <span aria-hidden="true" className="text-muted-foreground">
                        •
                      </span>
                      <span className="min-w-0">
                        <EntryText text={entry.text} />
                        {entry.pr && entry.url && (
                          <>
                            {' '}
                            <a
                              href={entry.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 whitespace-nowrap text-xs text-primary hover:underline"
                            >
                              #{entry.pr}
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              <span className="sr-only">
                                {t('whatsNew.opensInNewTab', '(opens in a new tab)')}
                              </span>
                            </a>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
