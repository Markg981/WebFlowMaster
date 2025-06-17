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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, TestTube, Loader2, PlusCircle, XCircle, History, Save, ListChecks, CheckCircle, XCircle as XCircleIcon, AlertCircle } from 'lucide-react';
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
import { ApiTestHistoryEntry, InsertApiTestHistoryEntry, ApiTest, InsertApiTest, Assertion } from '@shared/schema';
import { ScrollArea } from '@/components/ui/scroll-area';
import { v4 as uuidv4 } from 'uuid';

const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

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

const ApiTesterPage: React.FC = () => {
  const { theme } = useTheme();
  const [method, setMethod] = useState<string>(httpMethods[0]);
  const [url, setUrl] = useState<string>('');
  const [requestBodyValue, setRequestBodyValue] = useState<string>('');

  const [queryParams, setQueryParams] = useState<KeyValuePair[]>([{ id: `qp-${Date.now()}`, key: '', value: '', enabled: true }]);
  const [requestHeaders, setRequestHeaders] = useState<KeyValuePair[]>([{ id: `rh-${Date.now()}`, key: '', value: '', enabled: true }]);
  const [assertions, setAssertions] = useState<Assertion[]>([]);

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

  const saveToHistoryMutation = useMutation<ApiTestHistoryEntry, Error, InsertApiTestHistoryEntry>(
    async (historyEntry) => {
        const payload: InsertApiTestHistoryEntry = {
            ...historyEntry,
            queryParams: historyEntry.queryParams ? JSON.stringify(historyEntry.queryParams) : null,
            requestHeaders: historyEntry.requestHeaders ? JSON.stringify(historyEntry.requestHeaders) : null,
            responseHeaders: historyEntry.responseHeaders ? JSON.stringify(historyEntry.responseHeaders) : null,
            responseBody: historyEntry.responseBody ? (typeof historyEntry.responseBody === 'string' ? historyEntry.responseBody : JSON.stringify(historyEntry.responseBody)) : null,
        };
        return (await apiRequest('POST', '/api/api-test-history', payload)).json();
    },
    {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['apiTestHistory'] }); },
      onError: (error) => { toast({ title: "Failed to save to history", description: error.message, variant: "destructive", duration: 3000 }); }
    }
  );

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
          requestHeaders: currentHeadersForHistory, requestBody: variables.body as string,
          responseStatus: data.status, responseHeaders: data.headers,
          responseBody: data.body, durationMs: data.duration,
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
    const activeQueryParamsInternal = queryParams.filter(p => p.enabled && p.key.trim()).reduce((acc, p) => {
        if (acc[p.key]) {
            if (Array.isArray(acc[p.key])) { (acc[p.key] as string[]).push(p.value); }
            else { acc[p.key] = [acc[p.key] as string, p.value]; }
        } else { acc[p.key] = p.value; }
        return acc;
    }, {} as Record<string, string | string[]>);
    const activeHeadersInternal = requestHeaders.filter(h => h.enabled && h.key.trim()).reduce((acc, h) => { acc[h.key] = h.value; return acc; }, {} as Record<string, string>);
    let parsedBodyInternal: any = requestBodyValue;
    if ((method !== 'GET' && method !== 'HEAD') && requestBodyValue.trim()) {
        if (requestBodyValue.trim().startsWith("{") || requestBodyValue.trim().startsWith("[")) {
            try { parsedBodyInternal = JSON.parse(requestBodyValue); } catch (e) { /* ignore, send as string */ }
        }
    } else if (method === 'GET' || method === 'HEAD') {
        parsedBodyInternal = undefined;
    }
    apiProxyMutation.mutate({
      method, url, queryParams: activeQueryParamsInternal, headers: activeHeadersInternal,
      body: parsedBodyInternal, assertions: assertions.filter(a => a.enabled),
    });
  };

  const monacoTheme = theme === 'dark' || theme === 'system' ? 'vs-dark' : 'light';

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [currentTestToEdit, setCurrentTestToEdit] = useState<ApiTest | null>(null);

  const { data: historyData, isLoading: isLoadingHistory } = useQuery<{items: ApiTestHistoryEntry[], totalItems: number, totalPages: number}>(
    ['apiTestHistory'],
    async () => (await apiRequest('GET', '/api/api-test-history?limit=50')).json(),
    { staleTime: 1 * 60 * 1000 }
  );

  const { data: savedTestsData, isLoading: isLoadingSavedTests } = useQuery<ApiTest[]>(
    ['apiTests'],
    async () => (await apiRequest('GET', '/api/api-tests')).json(),
    { staleTime: 5 * 60 * 1000 }
  );

  const saveApiTestMutation = useMutation<ApiTest, Error, {name: string, projectId?: number | null} & Omit<InsertApiTest, 'userId' | 'projectId' | 'name' | 'createdAt' | 'updatedAt'>>(
      async (testData) => {
          const endpoint = currentTestToEdit ? `/api/api-tests/${currentTestToEdit.id}` : '/api/api-tests';
          const httpMethod = currentTestToEdit ? 'PUT' : 'POST';
          const payload = { ...testData,
              queryParams: testData.queryParams ? JSON.stringify(testData.queryParams) : null,
              requestHeaders: testData.requestHeaders ? JSON.stringify(testData.requestHeaders) : null,
              assertions: testData.assertions ? JSON.stringify(testData.assertions) : null, // Stringify assertions
          };
          return (await apiRequest(httpMethod, endpoint, payload)).json();
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['apiTests'] });
          setIsSaveModalOpen(false); setCurrentTestToEdit(null);
          toast({ title: currentTestToEdit ? 'Test Updated Successfully' : 'Test Saved Successfully' });
        },
        onError: (error) => { toast({ title: 'Save Test Failed', description: error.message, variant: 'destructive' });}
      }
  );

  const deleteApiTestMutation = useMutation<void, Error, number>(
      async (testId) => {
          const res = await apiRequest('DELETE', `/api/api-tests/${testId}`);
          if (!res.ok && res.status !== 204) {
            const errorData = await res.json().catch(() => ({ message: "Delete failed with status " + res.status }));
            throw new Error(errorData.error || "Failed to delete test");
          }
      },
      {
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
    toast({ title: "Loaded from history", description: `${item.method} ${item.url}`, duration: 2000 });
  };

  const handleOpenSaveModal = (testToEdit?: ApiTest) => {
      if (testToEdit) {
          setCurrentTestToEdit(testToEdit);
          setMethod(testToEdit.method); setUrl(testToEdit.url);
          const parseAndMap = (jsonStringOrArray: string | KeyValuePair[] | null, prefix: 'qp' | 'rh'): KeyValuePair[] => {
            if (!jsonStringOrArray) return [{ id: `${prefix}-${Date.now()}`, key: '', value: '', enabled: true }];
            try {
                const parsed = typeof jsonStringOrArray === 'string' ? JSON.parse(jsonStringOrArray) : jsonStringOrArray;
                if (Array.isArray(parsed) && parsed.every(p => typeof p.key === 'string' && typeof p.value === 'string')) {
                    return parsed.map((p, i) => ({ ...p, id: p.id || `${prefix}-${Date.now()}-${i}`, enabled: p.enabled !== undefined ? p.enabled : true }));
                } else if (typeof parsed === 'object' && parsed !== null) {
                    return Object.entries(parsed).map(([k, v], i) => ({id: `${prefix}-${Date.now()}-${i}`, key: k, value: Array.isArray(v) ? v.join(',') : String(v), enabled: true }));
                }
            } catch (e) { console.error("Error parsing params/headers from saved test:", e); }
            return [{ id: `${prefix}-${Date.now()}`, key: '', value: '', enabled: true }];
          };
          setQueryParams(parseAndMap(testToEdit.queryParams as any, 'qp'));
          setRequestHeaders(parseAndMap(testToEdit.requestHeaders as any, 'rh'));
          setRequestBodyValue(testToEdit.requestBody || '');
          setAssertions(testToEdit.assertions ? (typeof testToEdit.assertions === 'string' ? JSON.parse(testToEdit.assertions) : testToEdit.assertions) : []);
      } else {
          setCurrentTestToEdit(null);
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
      const config = {
          method, url, queryParams: currentParams, requestHeaders: currentHeaders,
          requestBody: requestBodyValue, assertions: assertions
      };
      saveApiTestMutation.mutate({ name, projectId, ...config });
  };

  const handleLoadSavedTest = (test: ApiTest) => {
    setMethod(test.method); setUrl(test.url);
    const parseAndMap = (jsonStringOrArray: string | KeyValuePair[] | null, prefix: 'qp' | 'rh'): KeyValuePair[] => {
        if (!jsonStringOrArray) return [{ id: `${prefix}-${Date.now()}`, key: '', value: '', enabled: true }];
        try {
            const parsed = typeof jsonStringOrArray === 'string' ? JSON.parse(jsonStringOrArray) : jsonStringOrArray;
             if (Array.isArray(parsed) && (parsed.length === 0 || typeof parsed[0].key === 'string')) {
                return parsed.map((p,i)=> ({...p, id: p.id || `${prefix}-${Date.now()}-${i}`}));
            } else if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                return Object.entries(parsed).map(([k, v], i) => ({ id: `${prefix}-${Date.now()}-${i}`, key: k, value: Array.isArray(v) ? v.join(',') : String(v), enabled: true }));
            }
        } catch (e) { console.error("Error parsing params/headers from saved test on load:", e); }
        return [{ id: `${prefix}-${Date.now()}`, key: '', value: '', enabled: true }];
    };
    setQueryParams(parseAndMap(test.queryParams as any, 'qp'));
    setRequestHeaders(parseAndMap(test.requestHeaders as any, 'rh'));
    setRequestBodyValue(test.requestBody || '');
    setAssertions(test.assertions ? (typeof test.assertions === 'string' ? JSON.parse(test.assertions) : test.assertions) : []);
    setResponseStatus(null); setResponseHeaders(null); setResponseBody(null); setDuration(null); setAssertionResults(null);
    setCurrentTestToEdit(test);
    toast({ title: "Loaded saved test", description: test.name, duration: 2000 });
  };

  const handleDeleteSavedTest = (testId: number) => {
    if (window.confirm("Are you sure you want to delete this saved test?")) {
      deleteApiTestMutation.mutate(testId);
    }
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
            <Link href="/dashboard" className="flex items-center space-x-2 text-primary hover:underline">
                <ArrowLeft className="h-5 w-5" />
            </Link>
            <TestTube className="h-6 w-6 text-primary" />
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
                onExportTest={handleExportTest} // Added from prev subtask
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
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="params" disabled={apiProxyMutation.isPending}>Query Params</TabsTrigger>
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
                <div className="p-4 border rounded-md min-h-[240px]">
                  <Label htmlFor="requestBodyEditor">Request Body</Label>
                  <div className="mt-1 border rounded-md overflow-hidden">
                    <Editor height="200px" language="json" theme={monacoTheme} value={requestBodyValue} onChange={(value) => setRequestBodyValue(value || '')}
                      options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13, wordWrap: 'on', automaticLayout: true, tabSize: 2, insertSpaces: true }}
                      onMount={(editor, monaco) => { editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { if (!apiProxyMutation.isPending) { handleSendRequest(); } }); }}
                      className={apiProxyMutation.isPending || method === 'GET' || method === 'HEAD' ? 'opacity-50 cursor-not-allowed' : ''}
                      readOnly={apiProxyMutation.isPending || method === 'GET' || method === 'HEAD'}/>
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
