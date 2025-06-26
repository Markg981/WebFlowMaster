// client/src/pages/GeneralReportsPage.tsx
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useRoute } from 'wouter'; // Added useRoute
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
// import { DatePickerWithRange } from '@/components/ui/date-range-picker'; // Placeholder
import {
  FileText, Filter, Loader2, AlertCircle, Eye, ChevronLeft, ChevronRight, Search,
  Home, PlusSquare, ListChecksIcon as TestsIcon, LibrarySquare as SuitesIcon,
  CalendarClock, FileTextIcon as ReportsIcon, Settings as SettingsIcon, Network,
  PanelLeftClose, PanelRightClose, UserCircle, TestTube
} from 'lucide-react';
import type { TestPlanExecution, TestPlan } from '@shared/schema';
import { format } from 'date-fns';
import { Badge } from "@/components/ui/badge";
import { useAuth } from '@/hooks/use-auth'; // For user info in sidebar

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
  if (filters.searchTerm) queryParams.append('search', filters.searchTerm);

  // Actual API call (replace mock)
  const response = await fetch(`/api/test-plan-executions?${queryParams.toString()}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Failed to fetch test executions' }));
    throw new Error(errorData.error || errorData.message || 'Failed to fetch test executions');
  }
  const data = await response.json();
  // Assuming the backend response structure is { items: [], limit: number, offset: number, totalItems?: number }
  // and we need to calculate totalPages and currentPage based on that.
  // For now, let's ensure the mock structure from API matches PaginatedExecutionsResponse if using mock.
  // If using real API, ensure data structure matches.
  return {
    items: data.items,
    totalItems: data.totalItems || data.items.length, // Fallback if totalItems not provided
    totalPages: data.totalPages || Math.ceil((data.totalItems || data.items.length) / limit), // Fallback
    currentPage: page,
    limit: limit,
  };

  // Fallback to mock if needed for development without backend ready:
  // console.log(`Fetching executions with params: ${queryParams.toString()}`);
  // await new Promise(resolve => setTimeout(resolve, 700));
  // const mockItems: TestPlanExecutionWithPlanName[] = [
  //   { id: 'exec_1', testPlanId: 'plan_abc', testPlanName: 'Login & Signup Flow', status: 'completed', startedAt: Math.floor(Date.now()/1000) - 3600, completedAt: Math.floor(Date.now()/1000) - 3000, environment: 'QA', browsers: '["chrome"]', triggeredBy: 'manual', totalTests: 10, passedTests: 8, failedTests: 2, skippedTests: 0, executionDurationMs: 60000, results: '' },
  //   { id: 'exec_2', testPlanId: 'plan_def', testPlanName: 'Payment Gateway Tests', status: 'failed', startedAt: Math.floor(Date.now()/1000) - 7200, completedAt: Math.floor(Date.now()/1000) - 6800, environment: 'Staging', browsers: '["firefox"]', triggeredBy: 'scheduled', totalTests: 5, passedTests: 2, failedTests: 3, skippedTests: 0, executionDurationMs: 40000, results: '' },
  //   { id: 'exec_3', testPlanId: 'plan_abc', testPlanName: 'Login & Signup Flow', status: 'running', startedAt: Math.floor(Date.now()/1000) - 600, completedAt: null, environment: 'QA', browsers: '["chrome"]', triggeredBy: 'manual', totalTests: null, passedTests: null, failedTests: null, skippedTests: null, executionDurationMs: null, results: '' },
  // ];
  // const filteredItems = mockItems.filter(item =>
  //   (!filters.planId || item.testPlanId === filters.planId) &&
  //   (!filters.status || item.status === filters.status) &&
  //   (!filters.searchTerm || item.testPlanName?.toLowerCase().includes(filters.searchTerm.toLowerCase()))
  // );
  // return { items: filteredItems.slice(0, limit) , totalItems: filteredItems.length, totalPages: Math.ceil(filteredItems.length/limit), currentPage: page, limit };
}

async function fetchTestPlansForFilter(): Promise<Pick<TestPlan, 'id' | 'name'>[]> {
    const response = await fetch('/api/test-plans');
    if(!response.ok) throw new Error('Failed to fetch test plans');
    const plans: TestPlan[] = await response.json();
    return plans.map(p => ({id: p.id, name: p.name}));
}


const GeneralReportsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [locationUrl, navigate] = useLocation(); // Renamed to avoid conflict if 'location' object is used
  const queryParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');


  // Sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Active route states for sidebar
  const [isDashboardActive] = useRoute('/dashboard');
  const [isCreateTestActive] = useRoute('/dashboard/create-test');
  const [isApiTesterActive] = useRoute('/dashboard/api-tester');
  const [isSettingsActive] = useRoute('/settings');
  const [isSuitesActive] = useRoute('/test-suites');
  const [isSchedulingActive] = useRoute('/scheduling');
  const [isReportsActive] = useRoute('/reports');


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
    // Consider adding page to URL as well if desired
    // params.set('page', currentPage.toString());
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

  // Sidebar link styles
  const linkBaseStyle = "flex items-center py-2 px-3 rounded-md text-sm font-medium";
  const activeLinkStyle = "bg-primary/10 text-primary";
  const inactiveLinkStyle = "text-foreground hover:bg-muted hover:text-foreground";
  const iconBaseStyle = "mr-3 h-5 w-5";
  const collapsedIconStyle = "h-6 w-6";


  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`bg-card text-card-foreground border-r border-border shrink-0 flex flex-col transition-all duration-300 ease-in-out ${
          isSidebarCollapsed ? 'w-20 p-2' : 'w-64 p-4'
        }`}
      >
        <div>
          <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'} p-1 mb-2 h-12`}>
            <div className="flex items-center">
              <TestTube className={`h-7 w-7 text-primary transition-all duration-300 ${isSidebarCollapsed ? 'ml-0' : 'mr-2'}`} />
              {!isSidebarCollapsed && (
                <span className="font-semibold text-lg whitespace-nowrap">{t('dashboardOverviewPage.webtestPlatform.text')}</span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              {isSidebarCollapsed ? <PanelRightClose size={20} /> : <PanelLeftClose size={20} />}
            </Button>
          </div>
          <nav className={isSidebarCollapsed ? "mt-2" : "mt-0"}>
            <ul className="space-y-1">
              <li><Link href="/dashboard" title={t('nav.dashboard')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isDashboardActive ? activeLinkStyle : inactiveLinkStyle}`}><Home className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.dashboard')}</span>}</Link></li>
              <li><Link href="/dashboard/api-tester" title={t('nav.apiTester', 'API Tester')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isApiTesterActive ? activeLinkStyle : inactiveLinkStyle}`}><Network className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.apiTester', 'API Tester')}</span>}</Link></li>
              <li><Link href="/dashboard/create-test" title={t('nav.createTest')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isCreateTestActive ? activeLinkStyle : inactiveLinkStyle}`}><PlusSquare className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.createTest')}</span>}</Link></li>
              <li><Link href="/test-suites" title={t('nav.suites')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isSuitesActive ? activeLinkStyle : inactiveLinkStyle}`}><SuitesIcon className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.suites')}</span>}</Link></li>
              <li><Link href="/scheduling" title={t('nav.scheduling', 'Scheduling')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isSchedulingActive ? activeLinkStyle : inactiveLinkStyle}`}><CalendarClock className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.scheduling', 'Scheduling')}</span>}</Link></li>
              <li><Link href="/reports" title={t('nav.reports')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isReportsActive ? activeLinkStyle : inactiveLinkStyle}`}><ReportsIcon className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.reports')}</span>}</Link></li>
              <li><Link href="/settings" title={t('nav.settings')} className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${isSettingsActive ? activeLinkStyle : inactiveLinkStyle}`}><SettingsIcon className={isSidebarCollapsed ? collapsedIconStyle : iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.settings')}</span>}</Link></li>
            </ul>
          </nav>
        </div>
        <div className={`mt-auto pt-4 border-t border-border ${isSidebarCollapsed ? 'px-0' : 'px-3'}`}>
          {user ? (isSidebarCollapsed ? <div className="flex justify-center items-center py-2" title={user.username}><UserCircle className="h-7 w-7 text-muted-foreground" /></div> : (<><p className="text-sm font-semibold text-foreground truncate">{user.username}</p><p className="text-xs text-muted-foreground truncate">{user.email || t('dashboardOverviewPage.noEmailProvided.text')}</p></>)) : (isSidebarCollapsed ? <div className="flex justify-center items-center py-2" title={t('dashboardOverviewPage.userNotLoaded.text')}><UserCircle className="h-7 w-7 text-muted-foreground opacity-50" /></div> : (<><p className="text-sm font-semibold text-muted-foreground">{t('dashboardOverviewPage.userNotLoaded.text')}</p><p className="text-xs text-muted-foreground">...</p></>))}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className={`flex-1 py-6 pr-6 pl-6 md:pl-8 overflow-auto transition-all duration-300 ease-in-out`}> {/* Adjusted pl for content spacing */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
                <div className="mb-2 md:mb-0">
                    <CardTitle className="text-2xl flex items-center">
                        <FileText className="mr-2 h-6 w-6 text-primary" />
                        {t('generalReportsPage.title', 'Test Execution Reports')}
                    </CardTitle>
                    <CardDescription>{t('generalReportsPage.description', 'View and filter past test plan executions.')}</CardDescription>
                </div>
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
                    <div className="flex items-center justify-end space-x-2 py-4">
                        <span className="text-sm text-muted-foreground">Page {executionsResponse.currentPage} of {executionsResponse.totalPages} (Total: {executionsResponse.totalItems} items)</span>
                        <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={executionsResponse.currentPage <= 1}><ChevronLeft className="h-4 w-4 mr-1"/> Previous</Button>
                        <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.min(executionsResponse.totalPages, prev + 1))} disabled={executionsResponse.currentPage >= executionsResponse.totalPages}>Next <ChevronRight className="h-4 w-4 ml-1"/></Button>
                    </div>
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
