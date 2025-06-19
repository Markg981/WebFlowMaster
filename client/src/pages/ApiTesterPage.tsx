// client/src/pages/ApiTesterPage.tsx
import React, { useState, useMemo, useEffect } from 'react';
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Network, Loader2, PlusCircle, XCircle, History, Save, ListChecks, CheckCircle, XCircle as XCircleIcon, AlertCircle } from 'lucide-react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import Editor from '@monaco-editor/react';
import { Checkbox } from "@/components/ui/checkbox";
import { useTheme } from "next-themes";
import { HistoryPanel } from '@/components/api-tester/HistoryPanel';
import { SavedTestsPanel } from '@/components/api-tester/SavedTestsPanel';
import { SaveApiTestModal } from '@/components/api-tester/SaveApiTestModal';
import { AssertionEditor } from '@/components/api-tester/AssertionEditor';
import { AuthorizationPanel } from '@/components/api-tester/AuthorizationPanel';
import { ApiTestHistoryEntry, InsertApiTestHistoryEntry, ApiTest, InsertApiTest, Assertion, AuthType, AuthParams } from '@shared/schema';
import { ScrollArea } from '@/components/ui/scroll-area';
import { v4 as uuidv4 } from 'uuid';

const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];
const bodyTypes = ['none', 'form-data', 'x-www-form-urlencoded', 'raw', 'binary', 'GraphQL'] as const;
type BodyType = typeof bodyTypes[number];

const bodyTypeDisplayMap: Record<BodyType, string> = {
  'none': 'None',
  'form-data': 'Form Data',
  'x-www-form-urlencoded': 'x-www-form-urlencoded',
  'raw': 'Raw (JSON, XML, Text, etc.)',
  'binary': 'Binary',
  'GraphQL': 'GraphQL'
};

interface ProxyResponse {
  success: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: any;
  duration?: number;
  error?: string;
  details?: any;
  assertionResults?: Array<{ assertion: Assertion; pass: boolean; actualValue: any; error?: string }>;
}

interface KeyValuePair {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

interface FormDataField {
  id: string;
  key: string;
  value: string | File | null; // File for type 'file', string for type 'text'
  enabled: boolean;
  type: 'text' | 'file';
}


const ApiTesterPage: React.FC = () => {
  const { theme } = useTheme();
  const [method, setMethod] = useState<string>(httpMethods[0]);
  const [url, setUrl] = useState<string>('');
  const [requestBodyValue, setRequestBodyValue] = useState<string>('');

  const [queryParams, setQueryParams] = useState<KeyValuePair[]>([{ id: `qp-${Date.now()}`, key: '', value: '', enabled: true }]);
  const [requestHeaders, setRequestHeaders] = useState<KeyValuePair[]>([{ id: `rh-${Date.now()}`, key: '', value: '', enabled: true }]);
  const [assertions, setAssertions] = useState<Assertion[]>([]);

  // Auth state
  const [authType, setAuthType] = useState<AuthType>('none');
  const [authParams, setAuthParams] = useState<AuthParams | undefined>(undefined);

  // Body type state
  const [selectedBodyType, setSelectedBodyType] = useState<BodyType>('raw');
  const [rawContentType, setRawContentType] = useState<string>('application/json');
  const [binaryBodyFile, setBinaryBodyFile] = useState<File | null>(null);
  const [graphqlQuery, setGraphqlQuery] = useState<string>('');
  const [graphqlVariables, setGraphqlVariables] = useState<string>('');
  const [formDataBody, setFormDataBody] = useState<FormDataField[]>([{ id: uuidv4(), key: '', value: '', enabled: true, type: 'text' }]);
  const [urlEncodedBody, setUrlEncodedBody] = useState<KeyValuePair[]>([{ id: uuidv4(), key: '', value: '', enabled: true }]);

  // Response state
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string> | null>(null);
  const [responseBody, setResponseBody] = useState<any>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [assertionResults, setAssertionResults] = useState<Array<{ assertion: Assertion; pass: boolean; actualValue: any; error?: string }> | null>(null);

  const queryClient = useQueryClient();

  const handleKeyValueChange = (
    index: number,
    field: 'key' | 'value' | 'enabled',
    newValue: string | boolean,
    type: 'query' | 'header'
  ) => {
    const setter = type === 'query' ? setQueryParams : setRequestHeaders;
    setter(prev =>
      prev.map((item, i) =>
        i === index ? { ...item, [field]: newValue } : item
      )
    );
  };

  const addKeyValuePair = (type: 'query' | 'header') => {
    const setter = type === 'query' ? setQueryParams : setRequestHeaders;
    const prefix = type === 'query' ? 'qp' : 'rh';
    setter(prev => [...prev, { id: `${prefix}-${Date.now()}`, key: '', value: '', enabled: true }]);
  };

  const removeKeyValuePair = (index: number, type: 'query' | 'header') => {
    const setter = type === 'query' ? setQueryParams : setRequestHeaders;
    setter(prev => prev.filter((_, i) => i !== index));
  };

  // FormData KV Management
  const handleFormDataChange = (index: number, field: keyof FormDataField, newValue: string | boolean | File | null) => {
    setFormDataBody(prev =>
      prev.map((item, i) => {
        if (i === index) {
          const updatedItem = { ...item, [field]: newValue };
          // If type changes to 'file', clear value (or set to null). If to 'text', ensure value is string.
          if (field === 'type') {
            updatedItem.value = (newValue === 'file') ? null : '';
          }
          return updatedItem;
        }
        return item;
      })
    );
  };

  const addFormDataField = () => {
    setFormDataBody(prev => [...prev, { id: uuidv4(), key: '', value: '', enabled: true, type: 'text' }]);
  };

  const removeFormDataField = (index: number) => {
    setFormDataBody(prev => prev.filter((_, i) => i !== index));
  };

  // URLEncoded KV Management
  const handleUrlEncodedChange = (index: number, field: keyof KeyValuePair, newValue: string | boolean) => {
    setUrlEncodedBody(prev =>
      prev.map((item, i) =>
        i === index ? { ...item, [field]: newValue } : item
      )
    );
  };

  const addUrlEncodedField = () => {
    setUrlEncodedBody(prev => [...prev, { id: uuidv4(), key: '', value: '', enabled: true }]);
  };

  const removeUrlEncodedField = (index: number) => {
    setUrlEncodedBody(prev => prev.filter((_, i) => i !== index));
  };


  const effectiveUrl = useMemo(() => {
    try {
      const base = url.includes('://') ? url : `http://${url || 'placeholder.com'}`;
      const newUrl = new URL(base);
      newUrl.search = '';
      queryParams
        .filter(p => p.enabled && p.key.trim())
        .forEach(p => newUrl.searchParams.append(p.key, p.value));
      if (url.includes('://')) return newUrl.toString();
      if (url.trim() === '') return '';
      return url.split('?')[0] + newUrl.search;
    } catch (e) {
      let queryString = '';
      if (queryParams.filter(p => p.enabled && p.key.trim()).length > 0) {
        const tempUrl = new URL("http://placeholder.com");
         queryParams.filter(p => p.enabled && p.key.trim()).forEach(p => tempUrl.searchParams.append(p.key, p.value));
        queryString = tempUrl.search;
      }
      return url + queryString;
    }
  }, [url, queryParams]);

  const saveToHistoryMutation = useMutation<
    ApiTestHistoryEntry,
    Error,
    InsertApiTestHistoryEntry
  >({ // Ensure this is an object literal for the options
    mutationFn: async (historyEntry: InsertApiTestHistoryEntry) => {
      const payloadForBackend: InsertApiTestHistoryEntry = {
          method: historyEntry.method,
          url: historyEntry.url,
          queryParams: historyEntry.queryParams,
          requestHeaders: historyEntry.requestHeaders,
          requestBody: historyEntry.requestBody,
          responseStatus: historyEntry.responseStatus,
          responseHeaders: historyEntry.responseHeaders,
          responseBody: historyEntry.responseBody,
          durationMs: historyEntry.durationMs,
      };
      // userId, id, createdAt are omitted as they are handled by backend/DB.
      // The InsertApiTestHistoryEntry type should reflect this.
      const response = await apiRequest('POST', '/api/api-test-history', payloadForBackend);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiTestHistory'] });
      // toast({ title: "Saved to history", duration: 2000 }); // Optional: subtle success toast
    },
    onError: (error: Error) => {
      console.error("Failed to save to history:", error);
      toast({
        title: "Error Saving History",
        description: error.message,
        variant: "destructive",
        duration: 3000,
      });
    }
  });

  const apiProxyMutation = useMutation<
    ProxyResponse,
    Error,
    { method: string; url: string; queryParams?: Record<string, string | string[]>; headers?: Record<string, string>; body?: any; assertions?: Assertion[] }
  >({
    mutationFn: async (variables) => {
      setResponseStatus(null); setResponseHeaders(null); setResponseBody(null); setDuration(null); setAssertionResults(null);
      const res = await apiRequest("POST", "/api/proxy-api-request", variables);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `API request failed with status ${res.status}`);
      if (!data.success && !data.assertionResults) throw new Error(data.error || "API request was not successful according to backend"); // Allow success=false if assertionResults are present
      return data;
    },
    onSuccess: (data, variables) => {
      setResponseStatus(data.status ?? null);
      setResponseHeaders(data.headers ?? null);
      setResponseBody(data.body ?? null);
      setDuration(data.duration ?? null);
      setAssertionResults(data.assertionResults || null);

      const hasAssertions = variables.assertions && variables.assertions.length > 0;
      const allAssertionsPassed = data.assertionResults?.every(r => r.pass) ?? true;
      const assertionSummary = data.assertionResults ? `(${data.assertionResults.filter(r => r.pass).length}/${data.assertionResults.length} passed)` : '';

      toast({
        title: data.status ? `Request Successful: ${data.status}` : "Request Successful",
        description: hasAssertions ? `Assertions ${assertionSummary}` : `API returned status ${data.status}`,
        variant: hasAssertions && !allAssertionsPassed ? "warning" : "default",
      });

      const currentParamsForHistory = queryParams.filter(p => p.enabled && p.key.trim()).reduce((acc, p) => {
        if (acc[p.key]) {
            if (Array.isArray(acc[p.key])) { (acc[p.key] as string[]).push(p.value); }
            else { acc[p.key] = [acc[p.key] as string, p.value]; }
        } else { acc[p.key] = p.value; }
        return acc;
      }, {} as Record<string, string | string[]>);
      const currentHeadersForHistory = requestHeaders.filter(h => h.enabled && h.key.trim()).reduce((acc, h) => { acc[h.key] = h.value; return acc; }, {} as Record<string, string>);
      const historyEntry: InsertApiTestHistoryEntry = {
          method: variables.method, url: variables.url, queryParams: currentParamsForHistory,
          requestHeaders: currentHeadersForHistory, requestBody: variables.body as string, // Assuming requestBody is already string or handled appropriately
          responseStatus: data.status, responseHeaders: data.headers,
          responseBody: (typeof data.body === 'object' && data.body !== null) ? JSON.stringify(data.body) : data.body,
          durationMs: data.duration,
      };
      saveToHistoryMutation.mutate(historyEntry);
    },
    onError: (error) => {
      setResponseStatus(null); setResponseHeaders(null);
      setResponseBody({ error: error.message, details: "See console for more details or network tab." });
      setDuration(null); setAssertionResults(null);
      toast({ title: "Request Failed", description: error.message, variant: "destructive" });
      console.error("API Proxy Request Error:", error);
    },
  });

  const handleSendRequest = () => {
    if (!url.trim()) {
      toast({ title: "URL Required", description: "Please enter a base URL to send the request.", variant: "destructive" });
      return;
    }

    let processedHeaders = requestHeaders
      .filter(h => h.enabled && h.key.trim())
      .reduce((acc, h) => { acc[h.key] = h.value; return acc; }, {} as Record<string, string>);

    let processedQueryParams = queryParams
      .filter(p => p.enabled && p.key.trim())
      .reduce((acc, p) => {
        if (acc[p.key]) {
          if (Array.isArray(acc[p.key])) { (acc[p.key] as string[]).push(p.value); }
          else { acc[p.key] = [acc[p.key] as string, p.value]; }
        } else { acc[p.key] = p.value; }
        return acc;
      }, {} as Record<string, string | string[]>);

    // Apply authentication
    if (authParams && authParams.type) {
      switch (authParams.type) {
        case 'basic':
          if (authParams.params.username) {
            const credentials = btoa(`${authParams.params.username}:${authParams.params.password || ''}`);
            processedHeaders['Authorization'] = `Basic ${credentials}`;
          }
          break;
        case 'bearer':
          if (authParams.params.token) {
            processedHeaders['Authorization'] = `Bearer ${authParams.params.token}`;
          }
          break;
        case 'apiKey':
          if (authParams.params.key && authParams.params.value) {
            if (authParams.params.addTo === 'header') {
              processedHeaders[authParams.params.key] = authParams.params.value;
            } else if (authParams.params.addTo === 'query') {
              // Add to a copy of processedQueryParams
              const queryParamsWithApiKey = { ...processedQueryParams };
              if (queryParamsWithApiKey[authParams.params.key]) {
                if (Array.isArray(queryParamsWithApiKey[authParams.params.key])) {
                  (queryParamsWithApiKey[authParams.params.key] as string[]).push(authParams.params.value);
                } else {
                  queryParamsWithApiKey[authParams.params.key] = [queryParamsWithApiKey[authParams.params.key] as string, authParams.params.value];
                }
              } else {
                queryParamsWithApiKey[authParams.params.key] = authParams.params.value;
              }
              processedQueryParams = queryParamsWithApiKey;
            }
          }
          break;
        // Other auth types can be added here
      }
    }

    let finalBody: any = undefined;
    let finalContentType: string | undefined = undefined;

    if (method !== 'GET' && method !== 'HEAD') {
      switch (selectedBodyType) {
        case 'none':
          finalBody = undefined;
          finalContentType = undefined;
          break;
        case 'form-data':
          const formData = new FormData();
          formDataBody.forEach(field => {
            if (field.enabled && field.key) {
              if (field.type === 'file' && field.value instanceof File) {
                formData.append(field.key, field.value);
              } else if (field.type === 'text') {
                formData.append(field.key, field.value as string);
              }
            }
          });
          finalBody = formData;
          finalContentType = undefined; // Browser will set this with boundary
          break;
        case 'x-www-form-urlencoded':
          const urlSearchParams = new URLSearchParams();
          urlEncodedBody.forEach(pair => {
            if (pair.enabled && pair.key) {
              urlSearchParams.append(pair.key, pair.value);
            }
          });
          finalBody = urlSearchParams.toString();
          finalContentType = 'application/x-www-form-urlencoded;charset=UTF-8';
          break;
        case 'raw':
          if (requestBodyValue.trim()) {
            if (rawContentType === 'application/json') {
              try {
                finalBody = JSON.parse(requestBodyValue);
              } catch (e) {
                finalBody = requestBodyValue; // Send as text if JSON is invalid
                toast({ title: "Invalid JSON", description: "Request body is not valid JSON. Sending as plain text.", variant: "warning", duration: 3000 });
              }
            } else {
              finalBody = requestBodyValue;
            }
          }
          finalContentType = rawContentType;
          break;
        case 'binary':
          finalBody = binaryBodyFile;
          finalContentType = binaryBodyFile?.type || 'application/octet-stream';
          break;
        case 'GraphQL':
          const gqlPayload: { query: string, variables?: object } = { query: graphqlQuery };
          if (graphqlVariables.trim()) {
            try {
              gqlPayload.variables = JSON.parse(graphqlVariables);
            } catch (e) {
              toast({ title: "Invalid GraphQL Variables", description: "Variables are not valid JSON. Sending query without variables.", variant: "warning", duration: 3000 });
            }
          }
          finalBody = JSON.stringify(gqlPayload);
          finalContentType = 'application/json';
          break;
      }
    }

    // Update Content-Type header
    if (finalContentType) {
      processedHeaders['Content-Type'] = finalContentType;
    } else {
      // For FormData, browser sets it, so remove any existing one.
      // For 'none' or GET/HEAD, also ensure it's not set.
      delete processedHeaders['Content-Type'];
      delete processedHeaders['content-type']; // Just in case
    }

    // Ensure body is undefined for GET/HEAD requests regardless of selectedBodyType
    if (method === 'GET' || method === 'HEAD') {
        finalBody = undefined;
        delete processedHeaders['Content-Type'];
        delete processedHeaders['content-type'];
    }

    apiProxyMutation.mutate({
      method,
      url, // Base URL, query params are handled separately
      queryParams: processedQueryParams,
      headers: processedHeaders,
      body: finalBody,
      assertions: assertions.filter(a => a.enabled),
    });
  };

  const monacoTheme = theme === 'dark' || theme === 'system' ? 'vs-dark' : 'light';

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [currentTestToEdit, setCurrentTestToEdit] = useState<ApiTest | null>(null);

  const { data: historyData, isLoading: isLoadingHistory } = useQuery({ // V5 Syntax
    queryKey: ['apiTestHistory'],
    queryFn: async () => (await apiRequest('GET', '/api/api-test-history?limit=50')).json(),
    staleTime: 1 * 60 * 1000
  });

  const { data: savedTestsData, isLoading: isLoadingSavedTests } = useQuery({ // V5 Syntax
    queryKey: ['apiTests'],
    queryFn: async () => (await apiRequest('GET', '/api/api-tests')).json(),
    staleTime: 5 * 60 * 1000
  });

  const saveApiTestMutation = useMutation<ApiTest, Error, {name: string, projectId?: number | null} & Omit<InsertApiTest, 'userId' | 'projectId' | 'name' | 'createdAt' | 'updatedAt'>>({
      mutationFn: async (testData) => {
          const endpoint = currentTestToEdit ? `/api/api-tests/${currentTestToEdit.id}` : '/api/api-tests';
          const httpMethod = currentTestToEdit ? 'PUT' : 'POST';
          const payload = { ...testData,
              queryParams: testData.queryParams ? JSON.stringify(testData.queryParams) : null,
              requestHeaders: testData.requestHeaders ? JSON.stringify(testData.requestHeaders) : null,
              assertions: testData.assertions ? JSON.stringify(testData.assertions) : null, // Stringify assertions
          };
          return (await apiRequest(httpMethod, endpoint, payload)).json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['apiTests'] });
        setIsSaveModalOpen(false); setCurrentTestToEdit(null);
        toast({ title: currentTestToEdit ? 'Test Updated Successfully' : 'Test Saved Successfully' });
      },
      onError: (error) => { toast({ title: 'Save Test Failed', description: error.message, variant: 'destructive' });}
    }
  );

  const deleteApiTestMutation = useMutation<void, Error, number>({
      mutationFn: async (testId) => {
          const res = await apiRequest('DELETE', `/api/api-tests/${testId}`);
          if (!res.ok && res.status !== 204) {
            const errorData = await res.json().catch(() => ({ message: "Delete failed with status " + res.status }));
            throw new Error(errorData.error || "Failed to delete test");
          }
      },
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['apiTests'] }); toast({ title: 'Test Deleted Successfully' }); },
      onError: (error) => { toast({ title: 'Delete Test Failed', description: error.message, variant: 'destructive' });}
    }
  );

  const handleLoadHistoryItem = (item: ApiTestHistoryEntry) => {
    setMethod(item.method); setUrl(item.url);
    setQueryParams(item.queryParams ? (typeof item.queryParams === 'string' ? JSON.parse(item.queryParams) : item.queryParams) : [{ id: `qp-${Date.now()}`, key: '', value: '', enabled: true }]);
    setRequestHeaders(item.requestHeaders ? (typeof item.requestHeaders === 'string' ? JSON.parse(item.requestHeaders) : item.requestHeaders) : [{ id: `rh-${Date.now()}`, key: '', value: '', enabled: true }]);
    setRequestBodyValue(item.requestBody || '');
    setResponseStatus(item.responseStatus ?? null);
    setResponseHeaders(item.responseHeaders ? (typeof item.responseHeaders === 'string' ? JSON.parse(item.responseHeaders) : item.responseHeaders) : null);
    setResponseBody(item.responseBody ? (typeof item.responseBody === 'string' ? item.responseBody : JSON.parse(item.responseBody)) : null);
    setDuration(item.durationMs ?? null);
    setAssertions([]);
    setAssertionResults(null);

    // Reset new auth and body states for history items
    setAuthType('none');
    setAuthParams(undefined);
    setSelectedBodyType('raw'); // Or 'none' if preferred, 'raw' is a common default
    setRawContentType('application/json');
    setFormDataBody([{ id: uuidv4(), key: '', value: '', enabled: true, type: 'text' }]);
    setUrlEncodedBody([{ id: uuidv4(), key: '', value: '', enabled: true }]);
    setGraphqlQuery('');
    setGraphqlVariables('');
    setBinaryBodyFile(null);

    toast({ title: "Loaded from history", description: `${item.method} ${item.url}`, duration: 2000 });
  };

  const loadTestState = (test: ApiTest) => {
    setMethod(test.method);
    setUrl(test.url);

    const parseKeyValuePairs = (jsonStringOrArray: string | KeyValuePair[] | null | undefined, prefix: 'qp' | 'rh'): KeyValuePair[] => {
      if (!jsonStringOrArray) return [{ id: `${prefix}-${Date.now()}`, key: '', value: '', enabled: true }];
      try {
        const parsed = typeof jsonStringOrArray === 'string' ? JSON.parse(jsonStringOrArray) : jsonStringOrArray;
        if (Array.isArray(parsed)) {
          if (parsed.length === 0) return [{ id: `${prefix}-${Date.now()}`, key: '', value: '', enabled: true }];
          // Ensure structure matches KeyValuePair (e.g. after loading from DB which might store plain objects)
          return parsed.map((p: any, i: number) => ({
            id: p.id || `${prefix}-${Date.now()}-${i}`,
            key: p.key || '',
            value: p.value || '',
            enabled: p.enabled !== undefined ? p.enabled : true,
          }));
        } else if (typeof parsed === 'object' && parsed !== null) { // Handle old object format for queryParams
          return Object.entries(parsed).map(([k, v], i) => ({
            id: `${prefix}-${Date.now()}-${i}`, key: k, value: Array.isArray(v) ? v.join(',') : String(v), enabled: true
          }));
        }
      } catch (e) { console.error(`Error parsing ${prefix} from saved test:`, e); }
      return [{ id: `${prefix}-${Date.now()}`, key: '', value: '', enabled: true }];
    };

    setQueryParams(parseKeyValuePairs(test.queryParams as any, 'qp'));
    setRequestHeaders(parseKeyValuePairs(test.requestHeaders as any, 'rh'));

    // Old requestBody is for raw text, primarily.
    // If selectedBodyType becomes 'raw', this will be its value.
    setRequestBodyValue(typeof test.requestBody === 'string' ? test.requestBody : '');

    setAssertions(test.assertions ? (typeof test.assertions === 'string' ? JSON.parse(test.assertions) : test.assertions) : []);

    // Load new fields
    setAuthType(test.authType || 'none');
    setAuthParams(test.authParams || undefined);
    setSelectedBodyType(test.bodyType || 'raw');
    setRawContentType(test.bodyRawContentType || 'application/json');
    setGraphqlQuery(test.bodyGraphqlQuery || '');
    setGraphqlVariables(test.bodyGraphqlVariables || '');
    setBinaryBodyFile(null); // Files cannot be re-loaded from DB, user must re-select

    if (test.bodyFormData) {
      const loadedFormData = (typeof test.bodyFormData === 'string' ? JSON.parse(test.bodyFormData) : test.bodyFormData) as Array<any>;
      setFormDataBody(
        loadedFormData.map(item => ({
          id: item.id || uuidv4(),
          key: item.key || '',
          value: item.type === 'file' ? null : item.value || '', // File objects can't be stored, set to null
          enabled: item.enabled !== undefined ? item.enabled : true,
          type: item.type || 'text',
          // Add fileName and fileType if they exist for file type, to inform the user
          ...(item.type === 'file' && item.fileName && { fileNamePlaceholder: item.fileName, fileTypePlaceholder: item.fileType }),
        }))
      );
      if (loadedFormData.some(item => item.type === 'file')) {
        toast({ title: "Form Data Files", description: "File entries need to be re-selected.", variant: "info", duration: 4000});
      }
    } else {
      setFormDataBody([{ id: uuidv4(), key: '', value: '', enabled: true, type: 'text' }]);
    }

    if (test.bodyUrlEncoded) {
      const loadedUrlEncoded = (typeof test.bodyUrlEncoded === 'string' ? JSON.parse(test.bodyUrlEncoded) : test.bodyUrlEncoded) as Array<any>;
      setUrlEncodedBody(
        loadedUrlEncoded.map(item => ({
          id: item.id || uuidv4(),
          key: item.key || '',
          value: item.value || '',
          enabled: item.enabled !== undefined ? item.enabled : true,
        }))
      );
    } else {
      setUrlEncodedBody([{ id: uuidv4(), key: '', value: '', enabled: true }]);
    }
  };


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

  const handleSaveTestConfirm = (name: string, projectId?: number | null) => {
      const currentParams = queryParams.filter(p => p.enabled && p.key.trim()).reduce((acc, p) => {
          if (acc[p.key]) {
              if (Array.isArray(acc[p.key])) { (acc[p.key] as string[]).push(p.value); }
              else { acc[p.key] = [acc[p.key] as string, p.value]; }
          } else { acc[p.key] = p.value; }
          return acc;
        }, {} as Record<string, string | string[]>);
      const currentHeaders = requestHeaders.filter(h => h.enabled && h.key.trim()).reduce((acc, h) => { acc[h.key] = h.value; return acc; }, {} as Record<string, string>);

      const transformedFormDataBody = formDataBody.map(field => {
        if (field.type === 'file' && field.value instanceof File) {
          return {
            id: field.id,
            key: field.key,
            enabled: field.enabled,
            type: 'file' as 'file', // Ensure literal type
            fileName: field.value.name,
            fileType: field.value.type,
            // value is not sent, backend will handle file through other means or this signals a file was present
          };
        }
        return field; // For text fields, keep as is (value is string)
      });

      const config: Omit<InsertApiTest, 'userId' | 'projectId' | 'name' | 'createdAt' | 'updatedAt'> = {
          method, url,
          queryParams: currentParams,
          requestHeaders: currentHeaders,
          // requestBody is the old field, new fields will store specific body types
          requestBody: selectedBodyType === 'raw' ? requestBodyValue :
                       selectedBodyType === 'GraphQL' ? JSON.stringify({query: graphqlQuery, variables: graphqlVariables}) : null,
          assertions: assertions,
          // New fields
          authType: authType,
          authParams: authParams,
          bodyType: selectedBodyType,
          bodyRawContentType: selectedBodyType === 'raw' ? rawContentType : undefined,
          bodyFormData: selectedBodyType === 'form-data' ? transformedFormDataBody : undefined,
          bodyUrlEncoded: selectedBodyType === 'x-www-form-urlencoded' ? urlEncodedBody : undefined,
          bodyGraphqlQuery: selectedBodyType === 'GraphQL' ? graphqlQuery : undefined,
          bodyGraphqlVariables: selectedBodyType === 'GraphQL' ? graphqlVariables : undefined,
      };
      saveApiTestMutation.mutate({ name, projectId, ...config });
  };

  const handleLoadSavedTest = (test: ApiTest) => {
    loadTestState(test);
    setResponseStatus(null); setResponseHeaders(null); setResponseBody(null); setDuration(null); setAssertionResults(null);
    setCurrentTestToEdit(test); // Keep track of the loaded test for "Save Changes" functionality
    toast({ title: "Loaded saved test", description: test.name, duration: 2000 });
  };

  const handleDeleteSavedTest = (testId: number) => {
    if (window.confirm("Are you sure you want to delete this saved test?")) {
      deleteApiTestMutation.mutate(testId);
    }
  };

  const handleExportTest = (test: ApiTest) => {
    const {
      id: testId, userId, projectId: testProjectId, createdAt, updatedAt,
      ...exportData
    } = test;

    const parseJsonField = (field: any) => {
      if (typeof field === 'string') {
        try { return JSON.parse(field); } catch (e) { return field; }
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
      assertions: parseJsonField(exportData.assertions),
    };

    const jsonString = JSON.stringify(exportedTestObject, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    const filename = `${(exportData.name || 'api_test').replace(/[\/:*?"<>|]/g, '_').replace(/\s+/g, '_')}.json`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(href);

    toast({
      title: "Test Exported",
      description: `${filename} has been downloaded.`,
    });
  };

  useEffect(() => {
    if (currentTestToEdit && isSaveModalOpen) { /* Future logic if needed */ }
  }, [currentTestToEdit, isSaveModalOpen]);

  const getResponseLanguage = (headers: Record<string, string> | null): string => {
    if (!headers) return 'plaintext';
    const contentType = headers['content-type'] || headers['Content-Type'] || '';
    if (contentType.includes('application/json')) return 'json';
    if (contentType.includes('application/xml') || contentType.includes('text/xml')) return 'xml';
    if (contentType.includes('text/html')) return 'html';
    if (contentType.includes('text/css')) return 'css';
    if (contentType.includes('application/javascript') || contentType.includes('text/javascript')) return 'javascript';
    if (contentType.includes('text/plain')) return 'plaintext';
    return 'plaintext';
  };
  const responseEditorLanguage = useMemo(() => getResponseLanguage(responseHeaders), [responseHeaders]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <header className="bg-card border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Link href="/dashboard" aria-label="Back to Dashboard">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <Network className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-card-foreground">API Tester</h1>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={() => handleOpenSaveModal()} disabled={apiProxyMutation.isPending}>
              <Save className="mr-2 h-4 w-4" />
              {currentTestToEdit ? "Save Changes" : "Save Test"}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/4 min-w-[300px] max-w-[400px] border-r border-border flex flex-col">
          <Tabs defaultValue="history" className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-2 rounded-none border-b">
              <TabsTrigger value="history" className="rounded-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary">
                <History className="mr-2 h-4 w-4"/> History
              </TabsTrigger>
              <TabsTrigger value="saved" className="rounded-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary">
                <ListChecks className="mr-2 h-4 w-4"/> Saved Tests
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
                savedTests={savedTestsData || []}
                onLoadTest={handleLoadSavedTest}
                onEditTest={(test) => handleOpenSaveModal(test)}
                onDeleteTest={handleDeleteSavedTest}
                onExportTest={handleExportTest}
                onOpenSaveModal={() => handleOpenSaveModal()}
                isLoading={isLoadingSavedTests}
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
                  <Label htmlFor="httpMethod">Method</Label>
                  <Select value={method} onValueChange={setMethod} disabled={apiProxyMutation.isPending}>
                    <SelectTrigger id="httpMethod"><SelectValue placeholder="Method" /></SelectTrigger>
                    <SelectContent>{httpMethods.map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}</SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label htmlFor="apiUrl">Base URL</Label>
                  <Input id="apiUrl" type="url" placeholder="https://api.example.com/data" value={url} onChange={(e) => setUrl(e.target.value)} disabled={apiProxyMutation.isPending} />
                </div>
                <Button size="lg" onClick={handleSendRequest} disabled={apiProxyMutation.isPending}>
                  {apiProxyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send
                </Button>
              </div>
              <div className="pt-2">
                 <Label htmlFor="effectiveUrlDisplay" className="text-xs text-muted-foreground">Effective URL (read-only):</Label>
                 <Input id="effectiveUrlDisplay" readOnly value={effectiveUrl || (url ? url : 'Enter base URL and add params...')} className="font-mono text-xs mt-1 bg-muted h-8" disabled={apiProxyMutation.isPending}/>
              </div>
            </div>

            <Tabs defaultValue="body" className="w-full">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="params" disabled={apiProxyMutation.isPending}>Query Params</TabsTrigger>
                <TabsTrigger value="auth" disabled={apiProxyMutation.isPending}>Authorization</TabsTrigger>
                <TabsTrigger value="headers" disabled={apiProxyMutation.isPending}>Headers</TabsTrigger>
                <TabsTrigger value="body" disabled={apiProxyMutation.isPending}>Body</TabsTrigger>
                <TabsTrigger value="assertions" disabled={apiProxyMutation.isPending}>Assertions</TabsTrigger>
              </TabsList>
              <TabsContent value="params">
                <div className="p-4 border rounded-md min-h-[200px] space-y-2">
                  {queryParams.map((param, index) => (
                    <div key={param.id} className="flex items-center space-x-2">
                      <Checkbox id={`qp-enabled-${param.id}`} checked={param.enabled} onCheckedChange={(checked) => handleKeyValueChange(index, 'enabled', !!checked, 'query')} disabled={apiProxyMutation.isPending}/>
                      <Input placeholder="Key" value={param.key} onChange={(e) => handleKeyValueChange(index, 'key', e.target.value, 'query')} className="flex-1" disabled={apiProxyMutation.isPending}/>
                      <Input placeholder="Value" value={param.value} onChange={(e) => handleKeyValueChange(index, 'value', e.target.value, 'query')} className="flex-1" disabled={apiProxyMutation.isPending}/>
                      <Button variant="ghost" size="icon" onClick={() => removeKeyValuePair(index, 'query')} disabled={apiProxyMutation.isPending}><XCircle className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => addKeyValuePair('query')} disabled={apiProxyMutation.isPending}><PlusCircle className="mr-2 h-4 w-4" /> Add Param</Button>
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
                  {requestHeaders.map((header, index) => (
                    <div key={header.id} className="flex items-center space-x-2">
                       <Checkbox id={`rh-enabled-${header.id}`} checked={header.enabled} onCheckedChange={(checked) => handleKeyValueChange(index, 'enabled', !!checked, 'header')} disabled={apiProxyMutation.isPending}/>
                      <Input placeholder="Header Name" value={header.key} onChange={(e) => handleKeyValueChange(index, 'key', e.target.value, 'header')} className="flex-1" disabled={apiProxyMutation.isPending}/>
                      <Input placeholder="Header Value" value={header.value} onChange={(e) => handleKeyValueChange(index, 'value', e.target.value, 'header')} className="flex-1" disabled={apiProxyMutation.isPending}/>
                      <Button variant="ghost" size="icon" onClick={() => removeKeyValuePair(index, 'header')} disabled={apiProxyMutation.isPending}><XCircle className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => addKeyValuePair('header')} disabled={apiProxyMutation.isPending}><PlusCircle className="mr-2 h-4 w-4" /> Add Header</Button>
                </div>
              </TabsContent>
              <TabsContent value="body">
                <div className="p-4 border rounded-md min-h-[240px] space-y-4">
                  <div>
                    <Label className="text-sm font-medium mb-2 block">Body Type</Label>
                    <RadioGroup
                      value={selectedBodyType}
                      onValueChange={(value: string) => setSelectedBodyType(value as BodyType)}
                      className="flex flex-wrap gap-x-4 gap-y-2"
                      disabled={apiProxyMutation.isPending}
                    >
                      {bodyTypes.map((type) => (
                        <div key={type} className="flex items-center space-x-2">
                          <RadioGroupItem value={type} id={`body-type-${type}`} disabled={apiProxyMutation.isPending} />
                          <Label htmlFor={`body-type-${type}`} className="font-normal">
                            {bodyTypeDisplayMap[type]}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>

                  {/* Dynamically rendered body input area */}
                  <div className="mt-4">
                    {selectedBodyType === 'none' && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        This request does not have a body.
                      </p>
                    )}

                    {selectedBodyType === 'raw' && (
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="raw-content-type">Content-Type</Label>
                          <Select
                            value={rawContentType}
                            onValueChange={setRawContentType}
                            disabled={apiProxyMutation.isPending}
                          >
                            <SelectTrigger id="raw-content-type" className="mt-1">
                              <SelectValue placeholder="Select content type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="application/json">application/json</SelectItem>
                              <SelectItem value="text/plain">text/plain</SelectItem>
                              <SelectItem value="application/xml">application/xml</SelectItem>
                              <SelectItem value="text/html">text/html</SelectItem>
                              <SelectItem value="application/javascript">application/javascript</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="requestBodyEditorRaw">Body</Label>
                          <div className="mt-1 border rounded-md overflow-hidden">
                            <Editor
                              height="200px"
                              language={rawContentType.includes('json') ? 'json' : rawContentType.includes('xml') ? 'xml' : rawContentType.includes('html') ? 'html' : 'plaintext'}
                              theme={monacoTheme}
                              value={requestBodyValue}
                              onChange={(value) => setRequestBodyValue(value || '')}
                              options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13, wordWrap: 'on', automaticLayout: true, tabSize: 2, insertSpaces: true }}
                              onMount={(editor, monaco) => { editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { if (!apiProxyMutation.isPending) { handleSendRequest(); } }); }}
                              className={apiProxyMutation.isPending || method === 'GET' || method === 'HEAD' ? 'opacity-50 cursor-not-allowed' : ''}
                              readOnly={apiProxyMutation.isPending || method === 'GET' || method === 'HEAD'}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedBodyType === 'binary' && (
                      <div>
                        <Label htmlFor="binary-file-input">Upload File</Label>
                        <Input
                          id="binary-file-input"
                          type="file"
                          onChange={(e) => setBinaryBodyFile(e.target.files ? e.target.files[0] : null)}
                          className="mt-1"
                          disabled={apiProxyMutation.isPending}
                        />
                        {binaryBodyFile && (
                          <p className="text-sm text-muted-foreground mt-2">
                            Selected file: {binaryBodyFile.name} ({Math.round(binaryBodyFile.size / 1024)} KB)
                          </p>
                        )}
                      </div>
                    )}

                    {selectedBodyType === 'GraphQL' && (
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="graphqlQueryEditor">GraphQL Query</Label>
                          <div className="mt-1 border rounded-md overflow-hidden">
                            <Editor
                              height="150px"
                              language="graphql"
                              theme={monacoTheme}
                              value={graphqlQuery}
                              onChange={(value) => setGraphqlQuery(value || '')}
                              options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13, wordWrap: 'on', automaticLayout: true }}
                              className={apiProxyMutation.isPending ? 'opacity-50 cursor-not-allowed' : ''}
                              readOnly={apiProxyMutation.isPending}
                            />
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="graphqlVariablesEditor">GraphQL Variables (JSON)</Label>
                          <div className="mt-1 border rounded-md overflow-hidden">
                            <Editor
                              height="100px"
                              language="json"
                              theme={monacoTheme}
                              value={graphqlVariables}
                              onChange={(value) => setGraphqlVariables(value || '')}
                              options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13, wordWrap: 'on', automaticLayout: true }}
                              className={apiProxyMutation.isPending ? 'opacity-50 cursor-not-allowed' : ''}
                              readOnly={apiProxyMutation.isPending}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                    {selectedBodyType === 'form-data' && (
                      <div className="space-y-2">
                        {formDataBody.map((field, index) => (
                          <div key={field.id} className="flex items-center space-x-2">
                            <Checkbox
                              id={`fd-enabled-${field.id}`}
                              checked={field.enabled}
                              onCheckedChange={(checked) => handleFormDataChange(index, 'enabled', !!checked)}
                              disabled={apiProxyMutation.isPending}
                            />
                            <Input
                              placeholder="Key"
                              value={field.key}
                              onChange={(e) => handleFormDataChange(index, 'key', e.target.value)}
                              className="flex-1"
                              disabled={apiProxyMutation.isPending}
                            />
                            <Select
                              value={field.type}
                              onValueChange={(type: 'text' | 'file') => handleFormDataChange(index, 'type', type)}
                              disabled={apiProxyMutation.isPending}
                            >
                              <SelectTrigger className="w-[100px]">
                                <SelectValue placeholder="Type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="text">Text</SelectItem>
                                <SelectItem value="file">File</SelectItem>
                              </SelectContent>
                            </Select>
                            {field.type === 'text' ? (
                              <Input
                                placeholder="Value"
                                value={field.value as string} // Cast because type 'text' implies string value
                                onChange={(e) => handleFormDataChange(index, 'value', e.target.value)}
                                className="flex-1"
                                disabled={apiProxyMutation.isPending}
                              />
                            ) : (
                              <Input
                                type="file"
                                onChange={(e) => handleFormDataChange(index, 'value', e.target.files ? e.target.files[0] : null)}
                                className="flex-1"
                                disabled={apiProxyMutation.isPending}
                              />
                            )}
                            <Button variant="ghost" size="icon" onClick={() => removeFormDataField(index)} disabled={apiProxyMutation.isPending}>
                              <XCircle className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        ))}
                        <Button variant="outline" size="sm" onClick={addFormDataField} disabled={apiProxyMutation.isPending}>
                          <PlusCircle className="mr-2 h-4 w-4" /> Add Field
                        </Button>
                      </div>
                    )}
                    {selectedBodyType === 'x-www-form-urlencoded' && (
                      <div className="space-y-2">
                        {urlEncodedBody.map((pair, index) => (
                          <div key={pair.id} className="flex items-center space-x-2">
                            <Checkbox
                              id={`ue-enabled-${pair.id}`}
                              checked={pair.enabled}
                              onCheckedChange={(checked) => handleUrlEncodedChange(index, 'enabled', !!checked)}
                              disabled={apiProxyMutation.isPending}
                            />
                            <Input
                              placeholder="Key"
                              value={pair.key}
                              onChange={(e) => handleUrlEncodedChange(index, 'key', e.target.value)}
                              className="flex-1"
                              disabled={apiProxyMutation.isPending}
                            />
                            <Input
                              placeholder="Value"
                              value={pair.value}
                              onChange={(e) => handleUrlEncodedChange(index, 'value', e.target.value)}
                              className="flex-1"
                              disabled={apiProxyMutation.isPending}
                            />
                            <Button variant="ghost" size="icon" onClick={() => removeUrlEncodedField(index)} disabled={apiProxyMutation.isPending}>
                              <XCircle className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        ))}
                        <Button variant="outline" size="sm" onClick={addUrlEncodedField} disabled={apiProxyMutation.isPending}>
                          <PlusCircle className="mr-2 h-4 w-4" /> Add Param
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="assertions">
                <div className="p-4 border rounded-md min-h-[240px]">
                  <AssertionEditor assertions={assertions} onChange={setAssertions} isExecuting={apiProxyMutation.isPending} />
                </div>
              </TabsContent>
            </Tabs>

            <div>
              <h2 className="text-xl font-semibold mb-2">Response</h2>
              <div className={`p-4 border rounded-md bg-muted min-h-[200px] ${apiProxyMutation.isPending ? 'opacity-50 animate-pulse' : ''}`}>
                <div className="flex justify-between items-center mb-2">
                  <div><span className="font-semibold">Status:</span>{' '}{responseStatus !== null ? (<span className={responseStatus >= 200 && responseStatus < 300 ? 'text-green-500 font-bold' : 'text-red-500 font-bold'}>{responseStatus}</span>) : ( '---' )}</div>
                  <div><span className="font-semibold">Time:</span> {duration !== null ? `${duration} ms` : (apiProxyMutation.isPending ? 'Loading...' : '---')}</div>
                </div>
                <Tabs defaultValue="responseBody" className="w-full">
                   <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="responseBody">Body</TabsTrigger>
                    <TabsTrigger value="responseHeaders">Headers</TabsTrigger>
                    <TabsTrigger value="assertionResults">Assertion Results</TabsTrigger>
                  </TabsList>
                  <TabsContent value="responseBody">
                    <div className="mt-1 border rounded-md overflow-hidden">
                      <Editor height="250px" language={responseEditorLanguage} theme={monacoTheme} value={responseBody !== null && responseBody !== undefined ? (typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody, null, 2)) : ''}
                        options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13, wordWrap: 'on', automaticLayout: true }}/>
                    </div>
                  </TabsContent>
                  <TabsContent value="responseHeaders">
                    <Textarea readOnly placeholder={apiProxyMutation.isPending ? "Loading response headers..." : "Response headers will appear here..."}
                      className="mt-1 h-[150px] bg-background font-mono text-sm"
                      value={responseHeaders ? JSON.stringify(responseHeaders, null, 2) : ''}/>
                  </TabsContent>
                  <TabsContent value="assertionResults">
                    <ScrollArea className="h-[250px] mt-1 p-2 border rounded-md bg-background">
                      {(assertionResults === null || assertionResults.length === 0) && !apiProxyMutation.isPending && <p className="text-sm text-muted-foreground p-4 text-center">No assertions were run or results are not available.</p>}
                      {apiProxyMutation.isPending && <p className="text-sm text-muted-foreground p-4 text-center">Running assertions...</p>}
                      {assertionResults && assertionResults.map((result, index) => (
                        <div key={result.assertion.id || index} className="p-2 mb-2 border rounded-md text-xs">
                          <div className="flex items-center justify-between">
                            <div className="font-medium">
                              <span className="text-muted-foreground">#{index + 1}: </span>
                              {result.assertion.source.replace(/_/g, ' ')}
                              {result.assertion.property && <span className="text-primary/80"> "{result.assertion.property}"</span>}
                              {' '}{result.assertion.comparison.replace(/_/g, ' ')}
                              {result.assertion.targetValue !== undefined && result.assertion.targetValue !== '' && <span className="text-primary/80"> "{result.assertion.targetValue}"</span>}
                            </div>
                            {result.pass ? (<CheckCircle className="h-4 w-4 text-green-500" />) : (<XCircleIcon className="h-4 w-4 text-red-500" />)}
                          </div>
                          <div className="text-muted-foreground mt-1">
                            {result.pass ? 'Passed.' : `Failed. (Actual: ${JSON.stringify(result.actualValue)})`}
                            {result.error && <span className="text-red-600 ml-1">(Error: {result.error})</span>}
                          </div>
                        </div>
                      ))}
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
      <SaveApiTestModal
        isOpen={isSaveModalOpen}
        onClose={() => { setIsSaveModalOpen(false); setCurrentTestToEdit(null); }}
        onSave={handleSaveTestConfirm}
        initialTestName={currentTestToEdit?.name || ''}
        initialProjectId={currentTestToEdit?.projectId}
        isEditing={!!currentTestToEdit}
        isLoading={saveApiTestMutation.isPending}
      />
    </div>
  );
};

export default ApiTesterPage;
