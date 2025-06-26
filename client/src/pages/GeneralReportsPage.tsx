// client/src/pages/GeneralReportsPage.tsx
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
// import { DatePickerWithRange } from '@/components/ui/date-range-picker'; // Placeholder
import {
  FileText, Filter, Loader2, AlertCircle, Eye, ChevronLeft, ChevronRight, Search, ArrowLeft
} from 'lucide-react';
import type { TestPlanExecution, TestPlan } from '@shared/schema';
import { format } from 'date-fns';
import { Badge } from "@/components/ui/badge";

// Mock/Placeholder for DatePickerWithRange if not available
const DatePickerWithRangePlaceholder = ({ date, onDateChange }: { date: any, onDateChange: (date: any) => void }) => (
  <Button variant="outline" onClick={() => console.log("Date Range Picker clicked")}>
    {date?.from ? `${format(date.from, "LLL dd, y")} - ${date.to ? format(date.to, "LLL dd, y") : ""}` : "Select Date Range"}
  </Button>
);

interface TestPlanExecutionWithPlanName extends TestPlanExecution {
  testPlanName?: string;
  scheduleName?: string;
}

interface PaginatedExecutionsResponse {
  items: TestPlanExecutionWithPlanName[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  limit: number;
}

// Using actual API endpoint now
async function fetchTestExecutions(
  page: number,
  limit: number,
  filters: { planId?: string | null; status?: string | null; dateFrom?: Date | null; dateTo?: Date | null; searchTerm?: string | null; }
): Promise<PaginatedExecutionsResponse> {
  const queryParams = new URLSearchParams();
  // Drizzle expects offset, not page for pagination directly in this backend
  queryParams.append('offset', ((page - 1) * limit).toString());
  queryParams.append('limit', limit.toString());

  if (filters.planId) queryParams.append('planId', filters.planId);
  if (filters.status) queryParams.append('status', filters.status);
  if (filters.searchTerm) queryParams.append('search', filters.searchTerm); // Assuming backend supports 'search' for plan name

  const response = await fetch(`/api/test-plan-executions?${queryParams.toString()}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Failed to fetch test executions' }));
    throw new Error(errorData.error || errorData.message || 'Failed to fetch test executions');
  }
  const data = await response.json();
  // The backend returns { items: [], limit: number, offset: number }
  // We need to calculate totalPages and currentPage based on what we have or what backend could provide
  // For now, if backend doesn't send totalItems, pagination will be basic next/prev based on items length
  const totalItems = data.totalItems || (data.items.length < limit && page === 1 ? data.items.length : (page * limit + (data.items.length === limit ? 1 : 0) ) ); // Estimate totalItems

  return {
    items: data.items,
    totalItems: totalItems,
    totalPages: Math.ceil(totalItems / limit),
    currentPage: page,
    limit: limit,
  };
}

async function fetchTestPlansForFilter(): Promise<Pick<TestPlan, 'id' | 'name'>[]> {
    const response = await fetch('/api/test-plans');
    if(!response.ok) throw new Error('Failed to fetch test plans');
    const plans: TestPlan[] = await response.json();
    return plans.map(p => ({id: p.id, name: p.name}));
}


const GeneralReportsPage: React.FC = () => {
  const { t } = useTranslation();
  const [locationUrl, navigate] = useLocation();
  const queryParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(queryParams.get('planId'));
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  // const [selectedDateRange, setSelectedDateRange] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const { data: testPlansForFilter = [] } = useQuery<Pick<TestPlan, 'id' | 'name'>[]>({
    queryKey: ['testPlansForFilter'],
    queryFn: fetchTestPlansForFilter,
  });

  const { data: executionsResponse, isLoading, error, isFetching, refetch } = useQuery<PaginatedExecutionsResponse, Error>({
    queryKey: ['testExecutions', currentPage, selectedPlanId, selectedStatus, /*selectedDateRange,*/ searchTerm],
    queryFn: () => fetchTestExecutions(currentPage, itemsPerPage, {
        planId: selectedPlanId,
        status: selectedStatus,
        searchTerm: searchTerm,
    }),
    keepPreviousData: true,
  });

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedPlanId) params.set('planId', selectedPlanId);
    if (selectedStatus) params.set('status', selectedStatus);
    if (searchTerm) params.set('search', searchTerm);
    navigate(`/reports?${params.toString()}`, { replace: true });
  }, [selectedPlanId, selectedStatus, searchTerm, navigate]);


  const handlePlanFilterChange = (planId: string) => {
    setSelectedPlanId(planId === 'all' ? null : planId);
    setCurrentPage(1);
  };
  const handleStatusFilterChange = (status: string) => {
    setSelectedStatus(status === 'all' ? null : status);
    setCurrentPage(1);
  };
   const handleSearchTermChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
    setCurrentPage(1);
  };

  const formatDuration = (ms: number | null | undefined) => {
    if (ms === null || ms === undefined || ms < 0) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getStatusBadgeVariant = (status: TestPlanExecution['status'] | undefined): "default" | "destructive" | "outline" | "secondary" => {
    if (!status) return "secondary";
    switch (status) {
      case 'completed': return 'default';
      case 'failed': return 'destructive';
      case 'running': return 'secondary';
      case 'pending': return 'outline';
      case 'error': return 'destructive';
      case 'cancelled': return 'outline';
      default: return 'secondary';
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Simplified Header */}
      <header className="bg-card border-b border-border px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" aria-label={t('generalReportsPage.backToDashboard', 'Back to Dashboard')}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <FileText className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-card-foreground">
              {t('generalReportsPage.title', 'Test Execution Reports')}
            </h1>
          </div>
          {/* Add any global actions for this page here if needed */}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto p-4 md:p-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
                <CardTitle className="text-lg flex items-center">
                    <Filter className="mr-2 h-5 w-5" />
                    {t('generalReportsPage.filters.title', 'Filters')}
                </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                <div className="space-y-1">
                    <label htmlFor="search-reports" className="text-sm font-medium">{t('generalReportsPage.filters.searchByName', 'Search by Plan Name')}</label>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input id="search-reports" placeholder={t('generalReportsPage.filters.searchPlaceholder', 'E.g., Login tests...')} className="pl-8" value={searchTerm} onChange={handleSearchTermChange}/>
                    </div>
                </div>
                <div className="space-y-1">
                    <label htmlFor="plan-filter" className="text-sm font-medium">{t('generalReportsPage.filters.testPlan', 'Test Plan')}</label>
                    <Select value={selectedPlanId || 'all'} onValueChange={handlePlanFilterChange}>
                        <SelectTrigger id="plan-filter"><SelectValue placeholder={t('generalReportsPage.filters.selectPlan', 'Select Test Plan')} /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t('generalReportsPage.filters.allPlans', 'All Plans')}</SelectItem>
                            {testPlansForFilter.map(plan => (<SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1">
                    <label htmlFor="status-filter" className="text-sm font-medium">{t('generalReportsPage.filters.status', 'Status')}</label>
                    <Select value={selectedStatus || 'all'} onValueChange={handleStatusFilterChange}>
                        <SelectTrigger id="status-filter"><SelectValue placeholder={t('generalReportsPage.filters.selectStatus', 'Select Status')} /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t('generalReportsPage.filters.allStatuses', 'All Statuses')}</SelectItem>
                            {['pending', 'running', 'completed', 'failed', 'error', 'cancelled'].map(status => (<SelectItem key={status} value={status} className="capitalize">{status}</SelectItem>))}
                        </SelectContent>
                    </Select>
                </div>
                <Button onClick={() => refetch()} disabled={isFetching || isLoading} className="w-full md:w-auto">
                    {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Filter className="mr-2 h-4 w-4" />}
                    {t('generalReportsPage.filters.apply', 'Apply Filters')}
                </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
                <CardTitle>{t('generalReportsPage.executionsList.title', 'Executions List')}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
                {isLoading && <div className="flex justify-center items-center py-10"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="ml-2">Loading executions...</p></div>}
                {error && <div className="text-red-500 text-center py-10"><AlertCircle className="mx-auto h-8 w-8 mb-2"/>Error loading executions: {error.message}</div>}
                {!isLoading && !error && executionsResponse?.items.length === 0 && (
                    <p className="text-muted-foreground text-center py-10">{t('generalReportsPage.executionsList.noResults', 'No executions found matching your criteria.')}</p>
                )}
                {!isLoading && !error && executionsResponse && executionsResponse.items.length > 0 && (
                    <>
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>{t('generalReportsPage.table.planName', 'Plan Name')}</TableHead>
                            <TableHead>{t('generalReportsPage.table.status', 'Status')}</TableHead>
                            <TableHead>{t('generalReportsPage.table.startedAt', 'Started At')}</TableHead>
                            <TableHead>{t('generalReportsPage.table.duration', 'Duration')}</TableHead>
                            <TableHead>{t('generalReportsPage.table.summary', 'Summary (P/F/S/T)')}</TableHead>
                            <TableHead>{t('generalReportsPage.table.triggeredBy', 'Triggered By')}</TableHead>
                            <TableHead>{t('generalReportsPage.table.actions', 'Actions')}</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                        {executionsResponse.items.map((exec) => (
                            <TableRow key={exec.id}>
                            <TableCell className="font-medium">{exec.testPlanName || exec.testPlanId}</TableCell>
                            <TableCell><Badge variant={getStatusBadgeVariant(exec.status)} className="capitalize">{exec.status}</Badge></TableCell>
                            <TableCell>{exec.startedAt ? format(new Date(exec.startedAt * 1000), 'PPpp') : 'N/A'}</TableCell>
                            <TableCell>{formatDuration(exec.executionDurationMs)}</TableCell>
                            <TableCell>{`${exec.passedTests ?? '-'}/${exec.failedTests ?? '-'}/${exec.skippedTests ?? '-'}/${exec.totalTests ?? '-'}`}</TableCell>
                            <TableCell className="capitalize">{exec.triggeredBy}</TableCell>
                            <TableCell><Button variant="outline" size="sm" asChild><Link href={`/test-plans/${exec.testPlanId}/executions/${exec.id}/report`}><Eye className="mr-1 h-4 w-4" /> {t('generalReportsPage.table.viewReport', 'View Report')}</Link></Button></TableCell>
                            </TableRow>
                        ))}
                        </TableBody>
                    </Table>
                    {executionsResponse.totalPages > 1 && (
                        <div className="flex items-center justify-end space-x-2 py-4">
                            <span className="text-sm text-muted-foreground">Page {executionsResponse.currentPage} of {executionsResponse.totalPages} (Total: {executionsResponse.totalItems} items)</span>
                            <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={executionsResponse.currentPage <= 1}><ChevronLeft className="h-4 w-4 mr-1"/> Previous</Button>
                            <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.min(executionsResponse.totalPages, prev + 1))} disabled={executionsResponse.currentPage >= executionsResponse.totalPages}>Next <ChevronRight className="h-4 w-4 ml-1"/></Button>
                        </div>
                    )}
                    </>
                )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default GeneralReportsPage;
