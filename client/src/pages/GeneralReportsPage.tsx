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
import { DatePickerWithRange } from '@/components/ui/date-range-picker'; // Assuming this exists or will be created
import { FileText, Filter, Loader2, AlertCircle, Eye, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { TestPlanExecution, TestPlan } from '@shared/schema'; // Import types
import { format } from 'date-fns'; // For date formatting

// Mock/Placeholder for DatePickerWithRange if not available
const DatePickerWithRangePlaceholder = ({ date, onDateChange }: { date: any, onDateChange: (date: any) => void }) => (
  <Button variant="outline" onClick={() => console.log("Date Range Picker clicked")}>
    {date?.from ? `${format(date.from, "LLL dd, y")} - ${date.to ? format(date.to, "LLL dd, y") : ""}` : "Select Date Range"}
  </Button>
);


// This type would ideally come from a shared location or be more specific
interface TestPlanExecutionWithPlanName extends TestPlanExecution {
  testPlanName?: string;
  scheduleName?: string; // If joining with schedules
}

interface PaginatedExecutionsResponse {
  items: TestPlanExecutionWithPlanName[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  limit: number;
}


// Mock API function - replace with actual API call
// The actual API is GET /api/test-plan-executions
async function fetchTestExecutions(
  page: number,
  limit: number,
  filters: { planId?: string | null; status?: string | null; dateFrom?: Date | null; dateTo?: Date | null; searchTerm?: string | null; }
): Promise<PaginatedExecutionsResponse> {
  const queryParams = new URLSearchParams();
  queryParams.append('offset', ((page - 1) * limit).toString());
  queryParams.append('limit', limit.toString());
  if (filters.planId) queryParams.append('planId', filters.planId);
  if (filters.status) queryParams.append('status', filters.status);
  if (filters.searchTerm) queryParams.append('search', filters.searchTerm); // Assuming backend supports 'search'
  // Backend would need to support dateFrom & dateTo if we add them
  // if (filters.dateFrom) queryParams.append('dateFrom', filters.dateFrom.toISOString());
  // if (filters.dateTo) queryParams.append('dateTo', filters.dateTo.toISOString());


  console.log(`Fetching executions with params: ${queryParams.toString()}`);
  // Simulate API call
  // const response = await fetch(`/api/test-plan-executions?${queryParams.toString()}`);
  // if (!response.ok) throw new Error('Failed to fetch test executions');
  // return response.json();

  // Mocked response for now:
  await new Promise(resolve => setTimeout(resolve, 700));
  const mockItems: TestPlanExecutionWithPlanName[] = [
    { id: 'exec_1', testPlanId: 'plan_abc', testPlanName: 'Login & Signup Flow', status: 'completed', startedAt: Math.floor(Date.now()/1000) - 3600, completedAt: Math.floor(Date.now()/1000) - 3000, environment: 'QA', browsers: '["chrome"]', triggeredBy: 'manual', totalTests: 10, passedTests: 8, failedTests: 2, skippedTests: 0, executionDurationMs: 60000, results: '' },
    { id: 'exec_2', testPlanId: 'plan_def', testPlanName: 'Payment Gateway Tests', status: 'failed', startedAt: Math.floor(Date.now()/1000) - 7200, completedAt: Math.floor(Date.now()/1000) - 6800, environment: 'Staging', browsers: '["firefox"]', triggeredBy: 'scheduled', totalTests: 5, passedTests: 2, failedTests: 3, skippedTests: 0, executionDurationMs: 40000, results: '' },
    { id: 'exec_3', testPlanId: 'plan_abc', testPlanName: 'Login & Signup Flow', status: 'running', startedAt: Math.floor(Date.now()/1000) - 600, completedAt: null, environment: 'QA', browsers: '["chrome"]', triggeredBy: 'manual', totalTests: null, passedTests: null, failedTests: null, skippedTests: null, executionDurationMs: null, results: '' },
  ];
  const filteredItems = mockItems.filter(item =>
    (!filters.planId || item.testPlanId === filters.planId) &&
    (!filters.status || item.status === filters.status) &&
    (!filters.searchTerm || item.testPlanName?.toLowerCase().includes(filters.searchTerm.toLowerCase()))
  );
  return { items: filteredItems.slice(0, limit) , totalItems: filteredItems.length, totalPages: Math.ceil(filteredItems.length/limit), currentPage: page, limit };
}

// Mock API for test plans (for filter dropdown)
async function fetchTestPlansForFilter(): Promise<Pick<TestPlan, 'id' | 'name'>[]> {
    // const response = await fetch('/api/test-plans?fields=id,name'); // Simplified fetch
    // if(!response.ok) throw new Error('Failed to fetch test plans');
    // return response.json();
    await new Promise(resolve => setTimeout(resolve, 300));
    return [
        {id: 'plan_abc', name: 'Login & Signup Flow'},
        {id: 'plan_def', name: 'Payment Gateway Tests'},
        {id: 'plan_ghi', name: 'User Profile Management'},
    ];
}


const GeneralReportsPage: React.FC = () => {
  const { t } = useTranslation();
  const [location, navigate] = useLocation();
  const queryParams = new URLSearchParams(location.search);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(queryParams.get('planId'));
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedDateRange, setSelectedDateRange] = useState<any>(null); // Adjust type for actual date range picker
  const [searchTerm, setSearchTerm] = useState('');


  const { data: testPlansForFilter = [] } = useQuery<Pick<TestPlan, 'id' | 'name'>[]>({
    queryKey: ['testPlansForFilter'],
    queryFn: fetchTestPlansForFilter,
  });

  const { data: executionsResponse, isLoading, error, isFetching, refetch } = useQuery<PaginatedExecutionsResponse, Error>({
    queryKey: ['testExecutions', currentPage, selectedPlanId, selectedStatus, selectedDateRange, searchTerm],
    queryFn: () => fetchTestExecutions(currentPage, itemsPerPage, {
        planId: selectedPlanId,
        status: selectedStatus,
        // dateFrom: selectedDateRange?.from,
        // dateTo: selectedDateRange?.to,
        searchTerm: searchTerm,
    }),
    keepPreviousData: true,
  });

  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedPlanId) params.set('planId', selectedPlanId);
    // Add other filters to params if needed
    // Use static path /reports to avoid issues with location.pathname being undefined initially
    navigate(`/reports?${params.toString()}`, { replace: true });
  }, [selectedPlanId, navigate]); // Removed location.pathname from dependencies as we use static path


  const handlePlanFilterChange = (planId: string) => {
    setSelectedPlanId(planId === 'all' ? null : planId);
    setCurrentPage(1); // Reset to first page on filter change
  };
  const handleStatusFilterChange = (status: string) => {
    setSelectedStatus(status === 'all' ? null : status);
    setCurrentPage(1);
  };
   const handleSearchTermChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
    setCurrentPage(1); // Reset page when search term changes
  };


  const formatDuration = (ms: number | null | undefined) => {
    if (ms === null || ms === undefined) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getStatusBadgeVariant = (status: TestPlanExecution['status']): "default" | "destructive" | "outline" | "secondary" => {
    switch (status) {
      case 'completed': return 'default'; // Green in theme
      case 'failed': return 'destructive';
      case 'running': return 'secondary'; // Blue/Info in theme
      case 'pending': return 'outline'; // Grayish
      case 'error': return 'destructive';
      case 'cancelled': return 'outline';
      default: return 'secondary';
    }
  };


  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
            <div className="mb-2 md:mb-0">
                <CardTitle className="text-2xl flex items-center">
                    <FileText className="mr-2 h-6 w-6" />
                    {t('generalReportsPage.title', 'Test Execution Reports')}
                </CardTitle>
                <CardDescription>{t('generalReportsPage.description', 'View and filter past test plan executions.')}</CardDescription>
            </div>
            {/* Add any global actions here if needed, e.g., "Export All Visible" */}
          </div>
        </CardHeader>
      </Card>

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
                    <SelectTrigger id="plan-filter">
                        <SelectValue placeholder={t('generalReportsPage.filters.selectPlan', 'Select Test Plan')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t('generalReportsPage.filters.allPlans', 'All Plans')}</SelectItem>
                        {testPlansForFilter.map(plan => (
                            <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
             <div className="space-y-1">
                <label htmlFor="status-filter" className="text-sm font-medium">{t('generalReportsPage.filters.status', 'Status')}</label>
                <Select value={selectedStatus || 'all'} onValueChange={handleStatusFilterChange}>
                    <SelectTrigger id="status-filter">
                        <SelectValue placeholder={t('generalReportsPage.filters.selectStatus', 'Select Status')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t('generalReportsPage.filters.allStatuses', 'All Statuses')}</SelectItem>
                        {['pending', 'running', 'completed', 'failed', 'error', 'cancelled'].map(status => (
                             <SelectItem key={status} value={status} className="capitalize">{status}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {/* <div className="space-y-1">
                 <label htmlFor="date-filter" className="text-sm font-medium">{t('generalReportsPage.filters.dateRange', 'Date Range')}</label>
                 <DatePickerWithRangePlaceholder date={selectedDateRange} onDateChange={setSelectedDateRange} />
            </div> */}
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
                    <TableHeader>
                    <TableRow>
                        <TableHead>{t('generalReportsPage.table.planName', 'Plan Name')}</TableHead>
                        <TableHead>{t('generalReportsPage.table.status', 'Status')}</TableHead>
                        <TableHead>{t('generalReportsPage.table.startedAt', 'Started At')}</TableHead>
                        <TableHead>{t('generalReportsPage.table.duration', 'Duration')}</TableHead>
                        <TableHead>{t('generalReportsPage.table.summary', 'Summary (P/F/S/T)')}</TableHead>
                        <TableHead>{t('generalReportsPage.table.triggeredBy', 'Triggered By')}</TableHead>
                        <TableHead>{t('generalReportsPage.table.actions', 'Actions')}</TableHead>
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                    {executionsResponse.items.map((exec) => (
                        <TableRow key={exec.id}>
                        <TableCell className="font-medium">{exec.testPlanName || exec.testPlanId}</TableCell>
                        <TableCell><Badge variant={getStatusBadgeVariant(exec.status)} className="capitalize">{exec.status}</Badge></TableCell>
                        <TableCell>{exec.startedAt ? format(new Date(exec.startedAt * 1000), 'PPpp') : 'N/A'}</TableCell>
                        <TableCell>{formatDuration(exec.executionDurationMs)}</TableCell>
                        <TableCell>{`${exec.passedTests ?? '-'}/${exec.failedTests ?? '-'}/${exec.skippedTests ?? '-'}/${exec.totalTests ?? '-'}`}</TableCell>
                        <TableCell className="capitalize">{exec.triggeredBy}</TableCell>
                        <TableCell>
                            <Button variant="outline" size="sm" asChild>
                            <Link href={`/test-plans/${exec.testPlanId}/executions/${exec.id}/report`}>
                                <Eye className="mr-1 h-4 w-4" /> {t('generalReportsPage.table.viewReport', 'View Report')}
                            </Link>
                            </Button>
                        </TableCell>
                        </TableRow>
                    ))}
                    </TableBody>
                </Table>
                {/* Pagination Controls */}
                <div className="flex items-center justify-end space-x-2 py-4">
                    <span className="text-sm text-muted-foreground">
                        Page {executionsResponse.currentPage} of {executionsResponse.totalPages} (Total: {executionsResponse.totalItems} items)
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={executionsResponse.currentPage <= 1}
                    >
                       <ChevronLeft className="h-4 w-4 mr-1"/> Previous
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(prev => Math.min(executionsResponse.totalPages, prev + 1))}
                        disabled={executionsResponse.currentPage >= executionsResponse.totalPages}
                    >
                        Next <ChevronRight className="h-4 w-4 ml-1"/>
                    </Button>
                </div>
                </>
            )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GeneralReportsPage;
