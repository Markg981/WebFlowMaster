// client/src/pages/ApiTesterPage.tsx
import { useConfirm } from '@/hooks/use-confirm';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, History, Save, ListChecks } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, errorMessage } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { useIsDark } from '@/hooks/use-is-dark';
import { HistoryPanel } from '@/components/api-tester/HistoryPanel';
import CatalogPagination from '@/components/catalog/CatalogPagination';
import { useCatalogControls } from '@/hooks/use-catalog-controls';
import { SavedTestsPanel, type ApiTestSummary } from '@/components/api-tester/SavedTestsPanel';
import { SaveApiTestModal } from '@/components/api-tester/SaveApiTestModal';
import { AssertionEditor } from '@/components/api-tester/AssertionEditor';
import { ExtractionEditor } from '@/components/api-tester/ExtractionEditor';
import { PerformanceEditor } from '@/components/api-tester/PerformanceEditor';
import { ProtocolConfigEditor } from '@/components/api-tester/ProtocolConfigEditor';
import { ConversationEditor } from '@/components/api-tester/ConversationEditor';
import { ProtocolConfigSchema, type ProtocolConfig } from '@shared/api-protocol-config';
import type { ApiPerformance } from '@shared/api-performance';
import { EnvironmentSelect } from '@/components/EnvironmentSelect';
import { NO_ENVIRONMENT, environmentIdFor } from '@/hooks/use-environments';
import { AuthorizationPanel } from '@/components/api-tester/AuthorizationPanel';
import {
  ApiTestHistoryEntry,
  InsertApiTestHistoryPayload,
  ApiTest,
  InsertApiTest,
  Assertion,
  Extraction,
  AuthType,
  AuthParams,
} from '@shared/schema';
import { ScrollArea } from '@/components/ui/scroll-area';
import { v4 as uuidv4 } from 'uuid';

import { KeyValueEditor } from '@/components/api-tester/KeyValueEditor';
import { RequestBodyEditor } from '@/components/api-tester/RequestBodyEditor';
import { ResponsePanel } from '@/components/api-tester/ResponsePanel';
import {
  httpMethods,
  type AssertionResult,
  type BodyType,
  type FormDataField,
  type KeyValuePair,
  type MultipartPart,
  type ProxyResponse,
} from '@/components/api-tester/request-model';
import {
  buildRequest,
  emptyFormDataRow,
  emptyUrlEncodedRow,
  parseKeyValueRows,
  requestFromTest,
} from '@/components/api-tester/request-state';
const ApiTesterForm: React.FC = () => {
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirm();
  const { user } = useAuth();
  const canEdit = user?.role !== 'viewer';
  const isDark = useIsDark();
  const [method, setMethod] = useState<string>(httpMethods[0]);
  const [url, setUrl] = useState<string>('');
  const [requestBodyValue, setRequestBodyValue] = useState<string>('');

  const [queryParams, setQueryParams] = useState<KeyValuePair[]>([
    { id: `qp-${Date.now()}`, key: '', value: '', enabled: true },
  ]);
  const [requestHeaders, setRequestHeaders] = useState<KeyValuePair[]>([
    { id: `rh-${Date.now()}`, key: '', value: '', enabled: true },
  ]);
  const [assertions, setAssertions] = useState<Assertion[]>([]);
  // Values this request hands to the ones after it in a plan, and what the last run of it
  // actually captured — so a capture can be confirmed here rather than when a plan fails.
  const [extractions, setExtractions] = useState<Extraction[]>([]);
  // Repetitions and response-time thresholds for plan runs (shared/api-performance.ts).
  const [performance, setPerformance] = useState<ApiPerformance | null>(null);
  const [protocolConfig, setProtocolConfig] = useState<ProtocolConfig | null>(null);
  const isProtocol = method === 'GRPC' || method === 'WEBSOCKET';
  // Which environment resolves {{variables}} here. Saved tests legitimately hold
  // {{baseUrl}}/… and {{secret_…}}, and without a choice they could only ever resolve
  // against the process defaults — so a request that worked here could fail in a plan.
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>(NO_ENVIRONMENT);
  const [lastCaptured, setLastCaptured] = useState<Record<string, string> | null>(null);
  const [lastCaptureErrors, setLastCaptureErrors] = useState<Array<{
    name: string;
    reason: string;
  }> | null>(null);

  // Auth state
  const [authType, setAuthType] = useState<AuthType>('none');
  const [authParams, setAuthParams] = useState<AuthParams | undefined>(undefined);

  // Body type state
  const [selectedBodyType, setSelectedBodyType] = useState<BodyType>('raw');
  const [rawContentType, setRawContentType] = useState<string>('application/json');
  const [binaryBodyFile, setBinaryBodyFile] = useState<File | null>(null);
  const [graphqlQuery, setGraphqlQuery] = useState<string>('');
  /** A gRPC test's .proto. */
  const [protoDefinition, setProtoDefinition] = useState<string>('');
  const [graphqlVariables, setGraphqlVariables] = useState<string>('');
  const [formDataBody, setFormDataBody] = useState<FormDataField[]>([
    { id: uuidv4(), key: '', value: '', enabled: true, type: 'text' },
  ]);
  const [urlEncodedBody, setUrlEncodedBody] = useState<KeyValuePair[]>([
    { id: uuidv4(), key: '', value: '', enabled: true },
  ]);

  // Response state
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string> | null>(null);
  const [responseBody, setResponseBody] = useState<any>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [assertionResults, setAssertionResults] = useState<AssertionResult[] | null>(null);

  const queryClient = useQueryClient();

  const handleKeyValueChange = (
    index: number,
    field: 'key' | 'value' | 'enabled',
    newValue: string | boolean,
    type: 'query' | 'header',
  ) => {
    const setter = type === 'query' ? setQueryParams : setRequestHeaders;
    setter((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: newValue } : item)));
  };

  const addKeyValuePair = (type: 'query' | 'header') => {
    const setter = type === 'query' ? setQueryParams : setRequestHeaders;
    const prefix = type === 'query' ? 'qp' : 'rh';
    setter((prev) => [
      ...prev,
      { id: `${prefix}-${Date.now()}`, key: '', value: '', enabled: true },
    ]);
  };

  const removeKeyValuePair = (index: number, type: 'query' | 'header') => {
    const setter = type === 'query' ? setQueryParams : setRequestHeaders;
    setter((prev) => prev.filter((_, i) => i !== index));
  };

  // FormData KV Management
  const handleFormDataChange = (
    index: number,
    field: keyof FormDataField,
    newValue: string | boolean | File | null,
  ) => {
    setFormDataBody((prev) =>
      prev.map((item, i) => {
        if (i === index) {
          const updatedItem = { ...item, [field]: newValue };
          // If type changes to 'file', clear value (or set to null). If to 'text', ensure value is string.
          if (field === 'type') {
            updatedItem.value = newValue === 'file' ? null : '';
          }
          return updatedItem;
        }
        return item;
      }),
    );
  };

  const addFormDataField = () => {
    setFormDataBody((prev) => [
      ...prev,
      { id: uuidv4(), key: '', value: '', enabled: true, type: 'text' },
    ]);
  };

  const removeFormDataField = (index: number) => {
    setFormDataBody((prev) => prev.filter((_, i) => i !== index));
  };

  // URLEncoded KV Management
  const handleUrlEncodedChange = (
    index: number,
    field: keyof KeyValuePair,
    newValue: string | boolean,
  ) => {
    setUrlEncodedBody((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: newValue } : item)),
    );
  };

  const addUrlEncodedField = () => {
    setUrlEncodedBody((prev) => [...prev, { id: uuidv4(), key: '', value: '', enabled: true }]);
  };

  const removeUrlEncodedField = (index: number) => {
    setUrlEncodedBody((prev) => prev.filter((_, i) => i !== index));
  };

  const effectiveUrl = useMemo(() => {
    try {
      const base = url.includes('://') ? url : `http://${url || 'placeholder.com'}`;
      const newUrl = new URL(base);
      newUrl.search = '';
      queryParams
        .filter((p) => p.enabled && p.key.trim())
        .forEach((p) => newUrl.searchParams.append(p.key, p.value));
      if (url.includes('://')) return newUrl.toString();
      if (url.trim() === '') return '';
      return url.split('?')[0] + newUrl.search;
    } catch (e) {
      let queryString = '';
      if (queryParams.filter((p) => p.enabled && p.key.trim()).length > 0) {
        const tempUrl = new URL('http://placeholder.com');
        queryParams
          .filter((p) => p.enabled && p.key.trim())
          .forEach((p) => tempUrl.searchParams.append(p.key, p.value));
        queryString = tempUrl.search;
      }
      return url + queryString;
    }
  }, [url, queryParams]);

  const saveToHistoryMutation = useMutation<
    ApiTestHistoryEntry,
    Error,
    InsertApiTestHistoryPayload & { environmentId?: number }
  >({
    // Ensure this is an object literal for the options
    mutationFn: async (historyEntry) => {
      const payloadForBackend = {
        method: historyEntry.method,
        url: historyEntry.url,
        queryParams: historyEntry.queryParams,
        requestHeaders: historyEntry.requestHeaders,
        requestBody: historyEntry.requestBody,
        responseStatus: historyEntry.responseStatus,
        responseHeaders: historyEntry.responseHeaders,
        responseBody: historyEntry.responseBody,
        durationMs: historyEntry.durationMs,
        // Lets the server take this environment's values back out of what it stores.
        environmentId: historyEntry.environmentId,
      };
      // userId, id, createdAt are omitted as they are handled by backend/DB.
      // The InsertApiTestHistoryPayload type should reflect this.
      const response = await apiRequest('POST', '/api/api-test-history', payloadForBackend as any);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiTestHistory'] });
      // toast({ title: "Saved to history", duration: 2000 }); // Optional: subtle success toast
    },
    onError: (error: Error) => {
      console.error('Failed to save to history:', error);
      toast({
        title: t('apiTesterPage.notifications.historySaveFailed.title', 'Error Saving History'),
        description: errorMessage(error),
        variant: 'destructive',
        duration: 3000,
      });
    },
  });

  const apiProxyMutation = useMutation<
    ProxyResponse,
    Error,
    {
      method: string;
      url: string;
      queryParams?: Record<string, string | string[]>;
      headers?: Record<string, string>;
      body?: any;
      multipart?: MultipartPart[];
      binary?: { contentType: string; base64: string; fileName: string };
      assertions?: Assertion[];
      extractions?: Extraction[];
      environmentId?: number;
      auth?: AuthParams;
      protocolConfig?: ProtocolConfig;
      protoDefinition?: string;
    }
  >({
    mutationFn: async (variables) => {
      setResponseStatus(null);
      setResponseHeaders(null);
      setResponseBody(null);
      setDuration(null);
      setAssertionResults(null);
      const res = await apiRequest('POST', '/api/proxy-api-request', variables);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `API request failed with status ${res.status}`);
      if (!data.success && !data.assertionResults)
        throw new Error(data.error || 'API request was not successful according to backend'); // Allow success=false if assertionResults are present
      return data;
    },
    onSuccess: (data, variables) => {
      setResponseStatus(data.status ?? null);
      setResponseHeaders(data.headers ?? null);
      setResponseBody(data.body ?? null);
      setDuration(data.duration ?? null);
      setAssertionResults(data.assertionResults || null);
      setLastCaptured(data.extracted ?? null);
      setLastCaptureErrors(data.extractionErrors ?? null);

      const hasAssertions = variables.assertions && variables.assertions.length > 0;
      const allAssertionsPassed = data.assertionResults?.every((r) => r.pass) ?? true;
      const assertionSummary = data.assertionResults
        ? `(${data.assertionResults.filter((r) => r.pass).length}/${data.assertionResults.length} passed)`
        : '';

      toast({
        title: data.status
          ? t(
              'apiTesterPage.notifications.requestSucceeded.titleWithStatus',
              'Request Successful: {{status}}',
              {
                status: data.status,
              },
            )
          : t('apiTesterPage.notifications.requestSucceeded.title', 'Request Successful'),
        description: hasAssertions
          ? t('apiTesterPage.notifications.requestSucceeded.assertions', 'Assertions {{summary}}', {
              summary: assertionSummary,
            })
          : t(
              'apiTesterPage.notifications.requestSucceeded.status',
              'API returned status {{status}}',
              {
                status: data.status,
              },
            ),
        variant: hasAssertions && !allAssertionsPassed ? 'destructive' : 'default',
      });

      const currentParamsForHistory = queryParams
        .filter((p) => p.enabled && p.key.trim())
        .reduce(
          (acc, p) => {
            if (acc[p.key]) {
              if (Array.isArray(acc[p.key])) {
                (acc[p.key] as string[]).push(p.value);
              } else {
                acc[p.key] = [acc[p.key] as string, p.value];
              }
            } else {
              acc[p.key] = p.value;
            }
            return acc;
          },
          {} as Record<string, string | string[]>,
        );
      const currentHeadersForHistory = requestHeaders
        .filter((h) => h.enabled && h.key.trim())
        .reduce(
          (acc, h) => {
            acc[h.key] = h.value;
            return acc;
          },
          {} as Record<string, string>,
        );

      let requestBodyForHistory: string | null;
      if (variables.multipart) {
        // What was sent, without the file contents: the history keeps a description, not uploads.
        const formDataEntries: Record<string, string> = {};
        variables.multipart.forEach((part) => {
          formDataEntries[part.key] =
            part.type === 'text' ? part.value : `[File: ${part.fileName}]`;
        });
        requestBodyForHistory = JSON.stringify(formDataEntries);
      } else if (variables.binary) {
        requestBodyForHistory = `[Binary File: ${variables.binary.fileName}]`;
      } else if (typeof variables.body === 'object' && variables.body !== null) {
        requestBodyForHistory = JSON.stringify(variables.body);
      } else {
        requestBodyForHistory = variables.body as string | null; // Already string, or null/undefined
      }

      const historyEntry = {
        method: variables.method,
        url: variables.url,
        queryParams: currentParamsForHistory,
        requestHeaders: currentHeadersForHistory,
        requestBody: requestBodyForHistory,
        responseStatus: data.status,
        responseHeaders: data.headers,
        responseBody:
          typeof data.body === 'object' && data.body !== null
            ? JSON.stringify(data.body)
            : data.body,
        durationMs: data.duration,
        environmentId: variables.environmentId,
      };
      saveToHistoryMutation.mutate(historyEntry as any);
    },
    onError: (error) => {
      setResponseStatus(null);
      setResponseHeaders(null);
      setResponseBody({
        error: error.message,
        details: 'See console for more details or network tab.',
      });
      setDuration(null);
      setAssertionResults(null);
      toast({
        title: t('apiTesterPage.notifications.requestFailed.title', 'Request Failed'),
        description: errorMessage(error),
        variant: 'destructive',
      });
      console.error('API Proxy Request Error:', error);
    },
  });

  const handleSendRequest = async () => {
    if (!validProtocolConfiguration()) return;
    if (!url.trim()) {
      toast({
        title: t('apiTesterPage.notifications.urlRequired.title', 'URL Required'),
        description: t(
          'apiTesterPage.notifications.urlRequired.description',
          'Please enter a base URL to send the request.',
        ),
        variant: 'destructive',
      });
      return;
    }

    const request = await buildRequest({
      method,
      queryParams,
      requestHeaders,
      bodyType: selectedBodyType,
      rawBody: requestBodyValue,
      rawContentType,
      binaryFile: binaryBodyFile,
      graphqlQuery,
      graphqlVariables,
      formData: formDataBody,
      urlEncoded: urlEncodedBody,
    });
    if (request.warnings.includes('invalid-json-body')) {
      toast({
        title: t('apiTesterPage.notifications.invalidJson.title', 'Invalid JSON'),
        description: t(
          'apiTesterPage.notifications.invalidJson.description',
          'Request body is not valid JSON. Sending as plain text.',
        ),
        variant: 'destructive',
        duration: 3000,
      });
    }
    if (request.warnings.includes('invalid-graphql-variables')) {
      toast({
        title: t(
          'apiTesterPage.notifications.invalidGraphqlVariables.title',
          'Invalid GraphQL Variables',
        ),
        description: t(
          'apiTesterPage.notifications.invalidGraphqlVariables.description',
          'Variables are not valid JSON. Sending query without variables.',
        ),
        variant: 'destructive',
        duration: 3000,
      });
    }

    // Authentication goes as settings (auth), applied by the server: see buildRequest.
    apiProxyMutation.mutate({
      method,
      url, // Base URL, query params are handled separately
      queryParams: request.queryParams,
      headers: request.headers,
      body: request.body,
      multipart: request.multipart,
      binary: request.binary,
      assertions: assertions.filter((a) => a.enabled),
      extractions: extractions.filter((e) => e.name.trim() !== ''),
      environmentId: environmentIdFor(selectedEnvironment),
      auth: authParams,
      ...(isProtocol && protocolConfig ? { protocolConfig } : {}),
      ...(method === 'GRPC' ? { protoDefinition } : {}),
    });
  };

  const monacoTheme = isDark ? 'vs-dark' : 'light';

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [currentTestToEdit, setCurrentTestToEdit] = useState<ApiTest | null>(null);

  const { data: historyData, isLoading: isLoadingHistory } = useQuery({
    // V5 Syntax
    queryKey: ['apiTestHistory', user?.organizationId, user?.id],
    queryFn: async () => (await apiRequest('GET', '/api/api-test-history?limit=50')).json(),
    staleTime: 1 * 60 * 1000,
  });

  const { search, setSearch, debouncedSearch, page, setPage, pageSize, setPageSize } =
    useCatalogControls();
  const {
    data: savedCatalog,
    isLoading: isLoadingSavedTests,
    isFetching: fetchingCatalog,
    error: catalogError,
  } = useQuery<{ items: ApiTestSummary[]; total: number; page: number; pageSize: number }>({
    queryKey: [
      'apiTests',
      user?.organizationId,
      user?.id,
      'catalog',
      page,
      pageSize,
      debouncedSearch,
    ],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search: debouncedSearch,
      });
      const response = await fetch('/api/catalog/api-tests?' + params, {
        signal,
        credentials: 'include',
      });
      if (!response.ok) throw new Error(t('catalog.loadFailed', 'Could not load the catalog.'));
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  useEffect(() => {
    if (savedCatalog)
      setPage((current) =>
        Math.min(current, Math.max(1, Math.ceil(savedCatalog.total / pageSize))),
      );
  }, [savedCatalog, pageSize, setPage]);
  const detailRequest = useRef(0);
  const [loadingDefinition, setLoadingDefinition] = useState(false);
  useEffect(
    () => () => {
      detailRequest.current++;
    },
    [],
  );
  const withDefinition = async (summary: ApiTestSummary, action: (test: ApiTest) => void) => {
    const request = ++detailRequest.current;
    setLoadingDefinition(true);
    try {
      const response = await apiRequest('GET', '/api/api-tests/' + summary.id);
      if (!response.ok)
        throw new Error(t('catalog.detailFailed', 'Could not load the test definition.'));
      const definition = (await response.json()) as ApiTest;
      if (request !== detailRequest.current) return;
      if (
        definition.id !== summary.id ||
        typeof definition.method !== 'string' ||
        typeof definition.url !== 'string'
      )
        throw new Error(t('catalog.detailFailed', 'Could not load the test definition.'));
      action(definition);
    } catch (error) {
      if (request === detailRequest.current)
        toast({
          variant: 'destructive',
          title: t('catalog.detailFailed', 'Could not load the test definition.'),
          description: (error as Error).message,
        });
    } finally {
      if (request === detailRequest.current) setLoadingDefinition(false);
    }
  };

  const saveApiTestMutation = useMutation<
    ApiTest,
    Error,
    { name: string; projectId?: number | null } & Omit<
      InsertApiTest,
      'userId' | 'projectId' | 'name' | 'createdAt' | 'updatedAt' | 'organizationId'
    >
  >({
    mutationFn: async (testData) => {
      const endpoint = currentTestToEdit
        ? `/api/api-tests/${currentTestToEdit.id}`
        : '/api/api-tests';
      const httpMethod = currentTestToEdit ? 'PUT' : 'POST';
      // These columns are jsonb: send real JSON. Pre-encoding them (a leftover from the
      // SQLite days) produced strings the server-side schema rejects, so every save 400'd.
      return (await apiRequest(httpMethod, endpoint, testData)).json();
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['apiTests'] });
      // The form still shows the test just saved, so it stays the one "Save Changes" updates.
      // Clearing it here made the next save of the same test create a copy instead.
      setIsSaveModalOpen(false);
      setCurrentTestToEdit(saved);
      toast({
        title: currentTestToEdit
          ? t('apiTesterPage.notifications.testUpdated.title', 'Test Updated Successfully')
          : t('apiTesterPage.notifications.testSaved.title', 'Test Saved Successfully'),
      });
    },
    onError: (error) => {
      toast({
        title: t('apiTesterPage.notifications.saveFailed.title', 'Save Test Failed'),
        description: errorMessage(error),
        variant: 'destructive',
      });
    },
  });

  const deleteApiTestMutation = useMutation<void, Error, number>({
    mutationFn: async (testId) => {
      const res = await apiRequest('DELETE', `/api/api-tests/${testId}`);
      if (!res.ok && res.status !== 204) {
        const errorData = await res
          .json()
          .catch(() => ({ message: 'Delete failed with status ' + res.status }));
        throw new Error(errorData.error || 'Failed to delete test');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiTests'] });
      toast({
        title: t('apiTesterPage.notifications.testDeleted.title', 'Test Deleted Successfully'),
      });
    },
    onError: (error) => {
      toast({
        title: t('apiTesterPage.notifications.deleteFailed.title', 'Delete Test Failed'),
        description: errorMessage(error),
        variant: 'destructive',
      });
    },
  });

  const handleLoadHistoryItem = (item: ApiTestHistoryEntry) => {
    // A history entry is not a saved test: saving it must not overwrite the test loaded before.
    setCurrentTestToEdit(null);
    setMethod(item.method);
    setUrl(item.url);

    setQueryParams(parseKeyValueRows(item.queryParams, 'qp'));
    setRequestHeaders(parseKeyValueRows(item.requestHeaders, 'rh'));

    setRequestBodyValue(item.requestBody || '');
    setResponseStatus(item.responseStatus ?? null);
    setResponseHeaders(
      item.responseHeaders
        ? typeof item.responseHeaders === 'string'
          ? JSON.parse(item.responseHeaders)
          : item.responseHeaders
        : null,
    );
    setResponseBody(
      item.responseBody
        ? typeof item.responseBody === 'string'
          ? item.responseBody
          : JSON.parse(item.responseBody)
        : null,
    );
    setDuration(item.durationMs ?? null);
    setAssertions([]);
    setAssertionResults(null);
    setPerformance(null);
    setProtocolConfig(null);
    setProtoDefinition('');

    // Reset new auth and body states for history items
    setAuthType('none');
    setAuthParams(undefined);
    setSelectedBodyType('raw'); // Or 'none' if preferred, 'raw' is a common default
    setRawContentType('application/json');
    setFormDataBody([emptyFormDataRow()]);
    setUrlEncodedBody([emptyUrlEncodedRow()]);
    setGraphqlQuery('');
    setGraphqlVariables('');
    setBinaryBodyFile(null);

    toast({
      title: t('apiTesterPage.notifications.loadedFromHistory.title', 'Loaded from history'),
      description: `${item.method} ${item.url}`,
      duration: 2000,
    });
  };

  // Memoized so the "load test from ?testId=" effect below doesn't re-run (and re-fetch)
  // on every render. Body only calls stable setters plus toast.
  const loadTestState = useCallback(
    (test: ApiTest) => {
      const loaded = requestFromTest(test);
      setProtocolConfig(loaded.protocolConfig);
      setMethod(loaded.method);
      setUrl(loaded.url);
      setQueryParams(loaded.queryParams);
      setRequestHeaders(loaded.requestHeaders);
      setRequestBodyValue(loaded.rawBody);
      setAssertions(loaded.assertions);
      setExtractions(loaded.extractions);
      setPerformance(loaded.performance);
      setAuthType(loaded.authType);
      setAuthParams(loaded.authParams);
      setSelectedBodyType(loaded.bodyType);
      setRawContentType(loaded.rawContentType);
      setGraphqlQuery(loaded.graphqlQuery);
      setGraphqlVariables(loaded.graphqlVariables);
      setProtoDefinition(loaded.protoDefinition);
      setBinaryBodyFile(null); // A file's bytes are not saved: the user picks it again
      setFormDataBody(loaded.formData);
      setUrlEncodedBody(loaded.urlEncoded);
      if (loaded.hasFileFields) {
        toast({
          title: t('apiTesterPage.notifications.formDataFiles.title', 'Form Data Files'),
          description: t(
            'apiTesterPage.notifications.formDataFiles.description',
            'File entries need to be re-selected.',
          ),
          variant: 'default',
          duration: 4000,
        });
      }
    },
    [t],
  );

  const handleOpenSaveModal = (testToEdit?: ApiTest) => {
    if (testToEdit) {
      setCurrentTestToEdit(testToEdit);
      loadTestState(testToEdit); // Use the common loader
    } else {
      setCurrentTestToEdit(null);
      // Optionally reset parts of the form if opening for a new test, though current UI state is often desired.
      // For now, it will save the current UI state as a new test.
    }
    setIsSaveModalOpen(true);
  };

  const validProtocolConfiguration = () => {
    if (!isProtocol) return true;
    if (
      !ProtocolConfigSchema.safeParse(protocolConfig ?? {}).success ||
      (protocolConfig?.tls &&
        Object.values(protocolConfig.tls).some(Boolean) &&
        (method !== 'GRPC' || (!/^grpcs:\/\//i.test(url) && !/^\{\{[^{}]+\}\}/.test(url))))
    ) {
      toast({
        title: t('apiTester.protocol.invalidTitle', 'Invalid protocol configuration'),
        description: t(
          'apiTester.protocol.invalidSend',
          'Check limits, paired TLS secret references and the grpcs:// address before saving or running.',
        ),
        variant: 'destructive',
      });
      return false;
    }
    return true;
  };

  const handleSaveTestConfirm = (name: string, projectId?: number | null) => {
    if (!validProtocolConfiguration()) return;
    const currentParams = queryParams
      .filter((p) => p.enabled && p.key.trim())
      .reduce(
        (acc, p) => {
          if (acc[p.key]) {
            if (Array.isArray(acc[p.key])) {
              (acc[p.key] as string[]).push(p.value);
            } else {
              acc[p.key] = [acc[p.key] as string, p.value];
            }
          } else {
            acc[p.key] = p.value;
          }
          return acc;
        },
        {} as Record<string, string | string[]>,
      );
    const currentHeaders = requestHeaders
      .filter((h) => h.enabled && h.key.trim())
      .reduce(
        (acc, h) => {
          acc[h.key] = h.value;
          return acc;
        },
        {} as Record<string, string>,
      );

    const transformedFormDataBody = formDataBody.map((field) => {
      if (field.type === 'file' && field.value instanceof File) {
        return {
          id: field.id,
          key: field.key,
          enabled: field.enabled,
          type: 'file' as const, // Ensure literal type
          fileName: field.value.name,
          fileType: field.value.type,
          // value is not sent, backend will handle file through other means or this signals a file was present
        };
      }
      return field; // For text fields, keep as is (value is string)
    });

    const config: Omit<
      InsertApiTest,
      'userId' | 'projectId' | 'name' | 'createdAt' | 'updatedAt' | 'organizationId'
    > = {
      method,
      url,
      queryParams: currentParams,
      requestHeaders: currentHeaders,
      // requestBody is the old field, new fields will store specific body types
      requestBody:
        selectedBodyType === 'raw'
          ? requestBodyValue
          : selectedBodyType === 'GraphQL'
            ? JSON.stringify({ query: graphqlQuery, variables: graphqlVariables })
            : null,
      assertions: assertions,
      extractions: extractions.filter((e) => e.name.trim() !== ''),
      performance,
      protocolConfig: isProtocol ? protocolConfig : null,
      // New fields
      authType: authType,
      authParams: authParams,
      bodyType: selectedBodyType,
      bodyRawContentType: selectedBodyType === 'raw' ? rawContentType : undefined,
      bodyFormData: selectedBodyType === 'form-data' ? transformedFormDataBody : undefined,
      bodyUrlEncoded: selectedBodyType === 'x-www-form-urlencoded' ? urlEncodedBody : undefined,
      bodyGraphqlQuery: selectedBodyType === 'GraphQL' ? graphqlQuery : undefined,
      bodyGraphqlVariables: selectedBodyType === 'GraphQL' ? graphqlVariables : undefined,
      protoDefinition: method === 'GRPC' ? protoDefinition : null,
    };
    saveApiTestMutation.mutate({ name, projectId, ...config });
  };

  const handleLoadSavedTest = (test: ApiTest) => {
    loadTestState(test);
    setResponseStatus(null);
    setResponseHeaders(null);
    setResponseBody(null);
    setDuration(null);
    setAssertionResults(null);
    setCurrentTestToEdit(test); // Keep track of the loaded test for "Save Changes" functionality
    toast({
      title: t('apiTesterPage.notifications.loadedSavedTest.title', 'Loaded saved test'),
      description: test.name,
      duration: 2000,
    });
  };

  const handleDeleteSavedTest = async (testId: number) => {
    const ok = await confirm({
      destructive: true,
      title: t('apiTesterPage.confirmDeleteSavedTest'),
    });
    if (ok) deleteApiTestMutation.mutate(testId);
  };

  const handleExportTest = (test: ApiTest) => {
    const {
      id: testId,
      userId,
      projectId: testProjectId,
      createdAt,
      updatedAt,
      ...exportData
    } = test;

    const parseJsonField = (field: any) => {
      if (typeof field === 'string') {
        try {
          return JSON.parse(field);
        } catch (e) {
          return field;
        }
      }
      return field;
    };

    const exportedTestObject = {
      name: exportData.name,
      url: exportData.url,
      method: exportData.method,
      queryParams: parseJsonField(exportData.queryParams),
      requestHeaders: parseJsonField(exportData.requestHeaders),
      requestBody: exportData.requestBody,
      protoDefinition: exportData.protoDefinition,
      protocolConfig: exportData.protocolConfig,
      assertions: parseJsonField(exportData.assertions),
    };

    const jsonString = JSON.stringify(exportedTestObject, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    const filename = `${(exportData.name || 'api_test').replace(/[/:*?"<>|]/g, '_').replace(/\s+/g, '_')}.json`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(href);

    toast({
      title: t('apiTesterPage.notifications.testExported.title', 'Test Exported'),
      description: t(
        'apiTesterPage.notifications.testExported.description',
        '{{filename}} has been downloaded.',
        {
          filename,
        },
      ),
    });
  };

  useEffect(() => {
    if (currentTestToEdit && isSaveModalOpen) {
      /* Future logic if needed */
    }
  }, [currentTestToEdit, isSaveModalOpen]);

  // Effect to load test data if testId is present in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const testId = params.get('testId');

    if (testId) {
      const fetchAndLoadTest = async (id: string) => {
        try {
          const response = await apiRequest('GET', `/api/api-tests/${id}`);
          if (!response.ok) {
            const errorData = await response
              .json()
              .catch(() => ({ message: `Test not found or error fetching test ${id}` }));
            throw new Error(errorData.error || errorData.message);
          }
          const testData: ApiTest = await response.json();
          loadTestState(testData);
          setCurrentTestToEdit(testData); // Important for "Save Changes" functionality
          toast({
            title: t('apiTesterPage.notifications.testLoaded.title', 'Test Loaded'),
            description: t(
              'apiTesterPage.notifications.testLoaded.description',
              'Loaded test: {{name}}',
              { name: testData.name },
            ),
          });
        } catch (error: any) {
          console.error('Failed to load test:', error);
          toast({
            title: t('apiTesterPage.notifications.loadFailed.title', 'Load Failed'),
            description:
              error.message ||
              t(
                'apiTesterPage.notifications.loadFailed.description',
                'Could not load the test with ID {{id}}.',
                { id },
              ),
            variant: 'default',
          });
        }
      };
      fetchAndLoadTest(testId);
    }
  }, [t, loadTestState]);

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {confirmDialog}
      <header className="flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-2">
        <h1 className="truncate text-sm font-semibold tracking-tight">
          {t('apiTesterPage.title')}
        </h1>
        {/* Opens the dialog on whatever the form holds: the loaded test when there is one
            ("Save Changes" updates it, with the edits made since loading), a new test otherwise.
            Going through handleOpenSaveModal() here dropped the loaded test, so "Save Changes"
            opened "Save New API Test". */}
        {canEdit && (
          <Button
            variant="default"
            size="sm"
            onClick={() => setIsSaveModalOpen(true)}
            disabled={apiProxyMutation.isPending}
          >
            <Save className="mr-2 h-4 w-4" />
            {currentTestToEdit
              ? t('apiTesterPage.saveChanges.button')
              : t('apiTesterPage.saveTest.button')}
          </Button>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/4 min-w-[300px] max-w-[400px] border-r border-border flex flex-col">
          <Tabs defaultValue="history" className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-2 rounded-none border-b">
              <TabsTrigger
                value="history"
                className="rounded-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
              >
                <History className="mr-2 h-4 w-4" />
                {t('apiTesterPage.history.title')}
              </TabsTrigger>
              <TabsTrigger
                value="saved"
                className="rounded-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary"
              >
                <ListChecks className="mr-2 h-4 w-4" />
                {t('apiTesterPage.savedTests.title')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="history" className="flex-1 overflow-y-auto ">
              <HistoryPanel
                historyItems={historyData?.items || []}
                onLoadHistoryItem={handleLoadHistoryItem}
                isLoading={isLoadingHistory}
              />
            </TabsContent>
            <TabsContent value="saved" className="flex-1 overflow-y-auto">
              <SavedTestsPanel
                savedTests={savedCatalog?.items ?? []}
                onLoadTest={(test) => void withDefinition(test, handleLoadSavedTest)}
                onEditTest={(test) => void withDefinition(test, handleOpenSaveModal)}
                onDeleteTest={handleDeleteSavedTest}
                onExportTest={(test) => void withDefinition(test, handleExportTest)}
                onOpenSaveModal={() => handleOpenSaveModal()}
                isLoading={isLoadingSavedTests || loadingDefinition}
                error={catalogError?.message}
                catalogControls={
                  <Input
                    className="m-3 w-auto"
                    aria-label={t('catalog.searchTests', 'Search tests')}
                    placeholder={t('catalog.searchTests', 'Search tests')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                }
                catalogPagination={
                  <CatalogPagination
                    page={page}
                    pageSize={pageSize}
                    total={savedCatalog?.total ?? 0}
                    busy={fetchingCatalog}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                  />
                }
                isDeletingTestId={deleteApiTestMutation.variables}
              />
            </TabsContent>
          </Tabs>
        </div>

        <ScrollArea className="flex-1 p-4 md:p-6">
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-end space-x-2">
                <div className="w-40">
                  <Label htmlFor="httpMethod">{t('apiTesterPage.method.label')}</Label>
                  <Select
                    value={method}
                    onValueChange={(value) => {
                      setMethod(value);
                      if (value !== 'GRPC')
                        setProtocolConfig((current) =>
                          current
                            ? {
                                timeoutMs: current.timeoutMs,
                                maxMessages: current.maxMessages,
                                maxBytes: current.maxBytes,
                              }
                            : null,
                        );
                    }}
                    disabled={apiProxyMutation.isPending}
                  >
                    <SelectTrigger id="httpMethod">
                      <SelectValue placeholder={t('apiTesterPage.method.label')} />
                    </SelectTrigger>
                    <SelectContent>
                      {httpMethods.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label htmlFor="apiUrl">{t('apiTesterPage.baseUrl.label')}</Label>
                  <Input
                    id="apiUrl"
                    type="url"
                    placeholder={t('apiTesterPage.httpsapiexamplecomdata.text')}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={apiProxyMutation.isPending}
                  />
                </div>
                <Button size="lg" onClick={handleSendRequest} disabled={apiProxyMutation.isPending}>
                  {apiProxyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{' '}
                  {t('apiTesterPage.send.button')}
                </Button>
              </div>
              {method === 'WEBSOCKET' && (
                <p className="text-xs text-muted-foreground" data-testid="websocket-hint">
                  {t(
                    'apiTesterPage.websocket.hint',
                    'A ws:// or wss:// address. The raw body holds the messages to send, one per line, or {"send": [...], "waitMs": 2000, "until": 1}. Assertions read the JSON body { messages, last, count }: last.type, messages[0].id, count.',
                  )}
                </p>
              )}
              {method === 'GRPC' && (
                <div className="space-y-1" data-testid="grpc-proto">
                  <Label htmlFor="protoDefinition">
                    {t('apiTesterPage.grpc.proto', 'Service definition (.proto)')}
                  </Label>
                  <Textarea
                    id="protoDefinition"
                    rows={6}
                    className="font-mono text-xs"
                    value={protoDefinition}
                    onChange={(e) => setProtoDefinition(e.target.value)}
                    placeholder={
                      'syntax = "proto3";\npackage shop;\nservice Orders { rpc Get (GetRequest) returns (Order); }'
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'apiTesterPage.grpc.hint',
                      'Address grpc://host:port/package.Service/Method (grpcs:// for TLS). The raw body is the request message as JSON; headers are sent as metadata. The status is the gRPC code, 0 for OK.',
                    )}
                  </p>
                </div>
              )}
              {isProtocol && (
                <ProtocolConfigEditor
                  method={method}
                  value={protocolConfig}
                  onChange={setProtocolConfig}
                  disabled={apiProxyMutation.isPending}
                />
              )}
              {isProtocol && selectedBodyType === 'raw' && (
                <ConversationEditor
                  key={`${currentTestToEdit?.id ?? 'new'}:${method}`}
                  value={requestBodyValue}
                  onChange={(value) => {
                    setRequestBodyValue(value);
                    setRawContentType('application/json');
                  }}
                  disabled={apiProxyMutation.isPending}
                />
              )}
              <div className="pt-2 max-w-xs">
                {/* Beside the URL, because {{baseUrl}} in the URL is the most common reason
                    to need one. */}
                <EnvironmentSelect
                  id="apiEnvironment"
                  value={selectedEnvironment}
                  onChange={setSelectedEnvironment}
                  disabled={apiProxyMutation.isPending}
                />
              </div>
              <div className="pt-2">
                <Label htmlFor="effectiveUrlDisplay" className="text-xs text-muted-foreground">
                  {t('apiTesterPage.effectiveUrlReadonly.label')}
                </Label>
                <Input
                  id="effectiveUrlDisplay"
                  readOnly
                  value={
                    effectiveUrl ||
                    (url ? url : t('apiTesterPage.enterBaseUrlAndAddParams.placeholder'))
                  }
                  className="font-mono text-xs mt-1 bg-muted h-8"
                  disabled={apiProxyMutation.isPending}
                />
              </div>
            </div>

            <Tabs defaultValue="body" className="w-full">
              <TabsList className="grid w-full grid-cols-7">
                <TabsTrigger value="params" disabled={apiProxyMutation.isPending}>
                  {t('apiTesterPage.queryParams.label')}
                </TabsTrigger>
                <TabsTrigger value="auth" disabled={apiProxyMutation.isPending}>
                  {t('apiTesterPage.authorization.label')}
                </TabsTrigger>
                <TabsTrigger value="headers" disabled={apiProxyMutation.isPending}>
                  {t('apiTesterPage.headers.label')}
                </TabsTrigger>
                <TabsTrigger value="body" disabled={apiProxyMutation.isPending}>
                  {t('apiTesterPage.body.label')}
                </TabsTrigger>
                <TabsTrigger value="assertions" disabled={apiProxyMutation.isPending}>
                  {t('apiTesterPage.assertions.label')}
                </TabsTrigger>
                <TabsTrigger value="captures" disabled={apiProxyMutation.isPending}>
                  Captures
                </TabsTrigger>
                <TabsTrigger value="performance" disabled={apiProxyMutation.isPending}>
                  {t('apiPerformance.tab', 'Performance')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="params">
                <div className="p-4 border rounded-md min-h-[200px] space-y-2">
                  <KeyValueEditor
                    rows={queryParams}
                    idPrefix="qp"
                    keyPlaceholder={t('apiTesterPage.key.label')}
                    valuePlaceholder={t('apiTesterPage.value.label')}
                    addLabel={t('apiTesterPage.addParam.button')}
                    disabled={apiProxyMutation.isPending}
                    onChange={(index, field, value) =>
                      handleKeyValueChange(index, field, value, 'query')
                    }
                    onAdd={() => addKeyValuePair('query')}
                    onRemove={(index) => removeKeyValuePair(index, 'query')}
                  />
                </div>
              </TabsContent>
              <TabsContent value="auth">
                <div className="p-4 border rounded-md min-h-[240px]">
                  <AuthorizationPanel
                    authType={authType}
                    authParams={authParams}
                    onAuthTypeChange={setAuthType}
                    onAuthParamsChange={setAuthParams}
                    disabled={apiProxyMutation.isPending}
                  />
                </div>
              </TabsContent>
              <TabsContent value="headers">
                <div className="p-4 border rounded-md min-h-[200px] space-y-2">
                  <KeyValueEditor
                    rows={requestHeaders}
                    idPrefix="rh"
                    keyPlaceholder={t('apiTesterPage.headerName.label')}
                    valuePlaceholder={t('apiTesterPage.headerValue.label')}
                    addLabel={t('apiTesterPage.addHeader.button')}
                    disabled={apiProxyMutation.isPending}
                    onChange={(index, field, value) =>
                      handleKeyValueChange(index, field, value, 'header')
                    }
                    onAdd={() => addKeyValuePair('header')}
                    onRemove={(index) => removeKeyValuePair(index, 'header')}
                  />
                </div>
              </TabsContent>
              <TabsContent value="body">
                <RequestBodyEditor
                  bodyType={selectedBodyType}
                  onBodyTypeChange={setSelectedBodyType}
                  method={method}
                  disabled={apiProxyMutation.isPending}
                  monacoTheme={monacoTheme}
                  onSend={handleSendRequest}
                  rawContentType={rawContentType}
                  onRawContentTypeChange={setRawContentType}
                  rawBody={requestBodyValue}
                  onRawBodyChange={setRequestBodyValue}
                  binaryFile={binaryBodyFile}
                  onBinaryFileChange={setBinaryBodyFile}
                  graphqlQuery={graphqlQuery}
                  onGraphqlQueryChange={setGraphqlQuery}
                  graphqlVariables={graphqlVariables}
                  onGraphqlVariablesChange={setGraphqlVariables}
                  formData={formDataBody}
                  onFormDataChange={handleFormDataChange}
                  onAddFormDataField={addFormDataField}
                  onRemoveFormDataField={removeFormDataField}
                  urlEncoded={urlEncodedBody}
                  onUrlEncodedChange={handleUrlEncodedChange}
                  onAddUrlEncodedField={addUrlEncodedField}
                  onRemoveUrlEncodedField={removeUrlEncodedField}
                />
              </TabsContent>
              <TabsContent value="assertions">
                <div className="p-4 border rounded-md min-h-[240px]">
                  <AssertionEditor
                    assertions={assertions}
                    onChange={setAssertions}
                    isExecuting={apiProxyMutation.isPending}
                  />
                </div>
              </TabsContent>
              <TabsContent value="captures">
                <div className="p-4 border rounded-md min-h-[240px]">
                  <ExtractionEditor
                    extractions={extractions}
                    onChange={setExtractions}
                    isExecuting={apiProxyMutation.isPending}
                    lastCaptured={lastCaptured}
                    lastErrors={lastCaptureErrors}
                  />
                </div>
              </TabsContent>
              <TabsContent value="performance">
                <div className="p-4 border rounded-md min-h-[240px]">
                  <PerformanceEditor
                    value={performance}
                    onChange={setPerformance}
                    disabled={apiProxyMutation.isPending}
                  />
                </div>
              </TabsContent>
            </Tabs>

            <ResponsePanel
              isProtocol={isProtocol}
              isPending={apiProxyMutation.isPending}
              monacoTheme={monacoTheme}
              status={responseStatus}
              headers={responseHeaders}
              body={responseBody}
              duration={duration}
              assertionResults={assertionResults}
            />
          </div>
        </ScrollArea>
      </div>
      <SaveApiTestModal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        onSave={handleSaveTestConfirm}
        initialTestName={currentTestToEdit?.name || ''}
        initialProjectId={currentTestToEdit?.projectId}
        isEditing={!!currentTestToEdit}
        isLoading={saveApiTestMutation.isPending}
      />
    </div>
  );
};

const ApiTesterPage: React.FC = () => {
  const { user } = useAuth();
  return <ApiTesterForm key={`${user?.organizationId}:${user?.id}`} />;
};
export default ApiTesterPage;
