import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { CodeEditor as Editor } from '@/components/CodeEditor';
import type { AssertionResult } from './request-model';

type Props = {
  /** A WebSocket or gRPC run, whose body is a transcript of messages rather than a response. */
  isProtocol: boolean;
  isPending: boolean;
  monacoTheme: string;
  status: number | null;
  headers: Record<string, string> | null;
  body: any;
  duration: number | null;
  assertionResults: AssertionResult[] | null;
};

function responseLanguage(headers: Record<string, string> | null): string {
  if (!headers) return 'plaintext';
  const contentType = headers['content-type'] || headers['Content-Type'] || '';
  if (contentType.includes('application/json')) return 'json';
  if (contentType.includes('application/xml') || contentType.includes('text/xml')) return 'xml';
  if (contentType.includes('text/html')) return 'html';
  if (contentType.includes('text/css')) return 'css';
  if (contentType.includes('application/javascript') || contentType.includes('text/javascript'))
    return 'javascript';
  return 'plaintext';
}

/** The API tester's Response section: status, time, and the body, headers and assertion results. */
export function ResponsePanel({
  isProtocol,
  isPending,
  monacoTheme,
  status,
  headers,
  body,
  duration,
  assertionResults,
}: Props) {
  const { t } = useTranslation();
  const language = useMemo(() => responseLanguage(headers), [headers]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">{t('apiTesterPage.response.label')}</h2>
      {isProtocol && body && typeof body === 'object' && Array.isArray(body.messages) && (
        <section className="space-y-2 rounded-md border p-3" data-testid="protocol-transcript">
          <h3 className="text-sm font-medium">
            {t('apiTester.protocol.transcript', 'Stream transcript and captures')}
          </h3>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">
            {JSON.stringify({ messages: body.messages, captures: body.captures ?? {} }, null, 2)}
          </pre>
        </section>
      )}
      <div
        className={`p-4 border rounded-md bg-muted min-h-[200px] ${isPending ? 'opacity-50 animate-pulse' : ''}`}
      >
        <div className="flex justify-between items-center mb-2">
          <div>
            <span className="font-semibold">{t('apiTesterPage.status.label')}</span>{' '}
            {status !== null ? (
              <span
                className={
                  status >= 200 && status < 300
                    ? 'text-success font-bold'
                    : 'text-destructive font-bold'
                }
              >
                {status}
              </span>
            ) : (
              t('apiTesterPage.text1')
            )}
          </div>
          <div>
            <span className="font-semibold">{t('apiTesterPage.time.label')}</span>{' '}
            {duration !== null
              ? `${duration} ms`
              : isPending
                ? t('apiTesterPage.loading.button')
                : t('apiTesterPage.text1')}
          </div>
        </div>
        <Tabs defaultValue="responseBody" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="responseBody">{t('apiTesterPage.body.label')}</TabsTrigger>
            <TabsTrigger value="responseHeaders">{t('apiTesterPage.headers.label')}</TabsTrigger>
            <TabsTrigger value="assertionResults">
              {t('apiTesterPage.assertionResults.label')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="responseBody">
            <div className="mt-1 border rounded-md overflow-hidden">
              <Editor
                height="250px"
                language={language}
                theme={monacoTheme}
                value={
                  body !== null && body !== undefined
                    ? typeof body === 'string'
                      ? body
                      : JSON.stringify(body, null, 2)
                    : ''
                }
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  wordWrap: 'on',
                  automaticLayout: true,
                }}
              />
            </div>
          </TabsContent>
          <TabsContent value="responseHeaders">
            <Textarea
              readOnly
              placeholder={
                isPending
                  ? t('apiTesterPage.loadingResponseHeaders.placeholder')
                  : t('apiTesterPage.responseHeadersWillAppearHere.placeholder')
              }
              className="mt-1 h-[150px] bg-background font-mono text-sm"
              value={headers ? JSON.stringify(headers, null, 2) : ''}
            />
          </TabsContent>
          <TabsContent value="assertionResults">
            <ScrollArea className="h-[250px] mt-1 p-2 border rounded-md bg-background">
              {(assertionResults === null || assertionResults.length === 0) && !isPending && (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  {t('apiTesterPage.noAssertionsWereRunOrResults.description')}
                </p>
              )}
              {isPending && (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  {t('apiTesterPage.runningAssertions.text')}
                </p>
              )}
              {assertionResults &&
                assertionResults.map((result, index) => (
                  <div
                    key={result.assertion.id || index}
                    className="p-2 mb-2 border rounded-md text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium">
                        <span className="text-muted-foreground">#{index + 1}: </span>
                        {result.assertion.source.replace(/_/g, ' ')}
                        {result.assertion.property && (
                          <span className="text-primary/80"> "{result.assertion.property}"</span>
                        )}{' '}
                        {result.assertion.comparison.replace(/_/g, ' ')}
                        {result.assertion.targetValue !== undefined &&
                          result.assertion.targetValue !== '' && (
                            <span className="text-primary/80">
                              {' '}
                              "{result.assertion.targetValue}"
                            </span>
                          )}
                      </div>
                      {result.pass ? (
                        <CheckCircle className="h-4 w-4 text-success" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                    </div>
                    <div className="text-muted-foreground mt-1">
                      {result.pass
                        ? 'Passed.'
                        : `Failed. (Actual: ${JSON.stringify(result.actualValue)})`}
                      {result.error && (
                        <span className="text-destructive ml-1">(Error: {result.error})</span>
                      )}
                    </div>
                  </div>
                ))}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
