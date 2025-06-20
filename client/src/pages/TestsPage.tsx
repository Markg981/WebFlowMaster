import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'wouter'; // Import useLocation
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, fromUnixTime, getTime, parseISO } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"; // Added AlertDialog components, removed AlertDialogTrigger as it's not directly used here
import { CalendarDays, FileText, Play, Search, RefreshCcw, ChevronLeft, ChevronRight, ArrowLeft, PlusCircle, MoreVertical, Trash2, Copy, Edit3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { ApiTest } from '@shared/schema'; // Import ApiTest type
import { apiRequest } from '@/lib/queryClient'; // For mutations
import { toast } from '@/hooks/use-toast'; // For notifications

// Interface for the data returned by GET /api/api-tests
interface ApiTestData extends ApiTest {
  creatorUsername: string | null;
  projectName: string | null;
}

interface TestItem {
  id: string;
  name: string;
  type: string;
  status: 'Pass' | 'Fail' | 'Pending' | 'Running';
  lastRun: string; // This TestItem is for the original mockTests, will be removed or repurposed.
}

// New interface for Test Plans, matching the backend schema
interface TestPlanItem {
  id: string;
  name: string;
  description: string | null; // Nullable text
  createdAt: number; // Unix timestamp (seconds)
  updatedAt: number; // Unix timestamp (seconds)
}

// Interface for general test data based on the 'tests' table schema
interface GeneralTestData {
  id: number;
  name: string;
  url: string;
  sequence: any; // Or string
  elements: any; // Or string
  status: string;
  createdAt: string; // Assuming string representation of timestamp
  updatedAt: string; // Assuming string representation of timestamp
  userId: number;
  projectId?: number | null;
  projectName?: string | null; // Added for consistency
  // Potentially add creatorUsername if that's also desired, similar to ApiTestData
}

interface ScheduleItem {
  id: string;
  scheduleName: string;
  testPlanId: string | null;
  testPlanName: string | null;
  frequency: string;
  nextRunAt: number; // Unix timestamp (seconds)
  createdAt: number; // Unix timestamp (seconds)
  updatedAt: number | null;
}

// initialMockTests is removed as we will fetch test plans from API.

// Helper function to format Unix timestamp (seconds) to datetime-local string
const formatTimestampToDateTimeLocal = (timestamp: number): string => {
  return format(fromUnixTime(timestamp), "yyyy-MM-dd'T'HH:mm");
};

// Helper function to format Unix timestamp (seconds) to readable date string
const formatTimestampToReadableDate = (timestamp: number): string => {
  return format(fromUnixTime(timestamp), 'yyyy-MM-dd HH:mm');
};


const TestsPage: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation(); // Get setLocation for navigation
  // State for the "Tests" tab (now UI Tests)
  const [uiTestSearchTerm, setUiTestSearchTerm] = useState('');
  // Removed mockTests state

  const [scheduleSearchTerm, setScheduleSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleItem | null>(null);
  // Edit modal form states for Schedules
  const [editableScheduleName, setEditableScheduleName] = useState('');
  const [editableScheduleTestPlanId, setEditableScheduleTestPlanId] = useState(''); // For editing a schedule's linked TestPlanID
  // editableTestPlanName for schedule is derived, not directly set.
  const [editableFrequency, setEditableFrequency] = useState('');
  const [editableNextRunAt, setEditableNextRunAt] = useState('');

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(null);

  // State for API Tests Tab
  const [apiTestsData, setApiTestsData] = useState<ApiTestData[]>([]); // Holds all fetched API tests
  const [apiTestSearchTerm, setApiTestSearchTerm] = useState('');
  const [currentApiTestPage, setCurrentApiTestPage] = useState(1);
  const [apiItemsPerPage] = useState(10); // Or make it configurable

  // Create Schedule Modal States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newScheduleName, setNewScheduleName] = useState('');
  const [newScheduleTestPlanId, setNewScheduleTestPlanId] = useState<string | null>(null); // Can be null initially or if no test plans
  const [newFrequency, setNewFrequency] = useState('Daily');
  const [newNextRunAtString, setNewNextRunAtString] = useState(() => formatTimestampToDateTimeLocal(Math.floor(Date.now() / 1000) + 3600));

  // Create Test Plan Modal States
  const [isCreateTestPlanModalOpen, setIsCreateTestPlanModalOpen] = useState(false);
  const [newTestPlanNameState, setNewTestPlanNameState] = useState('');
  const [newTestPlanDescription, setNewTestPlanDescription] = useState('');

  // Edit Test Plan Modal States
  const [isEditTestPlanModalOpen, setIsEditTestPlanModalOpen] = useState(false);
  const [editingTestPlan, setEditingTestPlan] = useState<TestPlanItem | null>(null);
  const [editableTestPlanName, setEditableTestPlanName] = useState('');
  const [editableTestPlanDescription, setEditableTestPlanDescription] = useState('');

  // Delete Test Plan Dialog States
  const [isDeleteTestPlanConfirmOpen, setIsDeleteTestPlanConfirmOpen] = useState(false);
  const [deletingTestPlanId, setDeletingTestPlanId] = useState<string | null>(null);

  // Delete API Test Dialog States
  const [isDeleteApiTestConfirmOpen, setIsDeleteApiTestConfirmOpen] = useState(false);
  const [deletingApiTestId, setDeletingApiTestId] = useState<number | null>(null); // API Test ID is number
  const [deletingApiTestName, setDeletingApiTestName] = useState<string | null>(null);


  // Fetch schedules using React Query
  const { data: schedules = [], isLoading: isLoadingSchedules, error: schedulesError } = useQuery<ScheduleItem[]>({
    queryKey: ['schedules'],
    queryFn: async () => { /* ... unchanged ... */ },
  });

  // Fetch UI Tests (formerly Test Plans, now general tests) using React Query
  const { data: uiTests = [], isLoading: isLoadingUiTests, error: uiTestsError } = useQuery<GeneralTestData[]>({
    queryKey: ['uiTests'], // Changed queryKey
    queryFn: async () => {
      const response = await fetch('/api/tests'); // Fetch general tests
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Network response was not ok for UI tests' }));
        throw new Error(errorData.error || errorData.message || 'Failed to fetch UI tests');
      }
      return response.json();
    },
  });

  // Fetch API Tests using React Query
  const { data: fetchedApiTests, isLoading: isLoadingApiTests, error: apiTestsError } = useQuery<ApiTestData[]>({
    queryKey: ['apiTestsList'], // Unique query key for this list
    queryFn: async () => {
      const response = await fetch('/api/api-tests');
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Network response was not ok for API tests' }));
        throw new Error(errorData.error || errorData.message || 'Failed to fetch API tests');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setApiTestsData(data); // Populate local state on successful fetch
    }
  });

  // Fetch actual Test Plans for Schedule modals
  const { data: actualTestPlans = [], isLoading: isLoadingActualTestPlans, error: actualTestPlansError } = useQuery<TestPlanItem[]>({
    queryKey: ['actualTestPlans'], // New, distinct queryKey
    queryFn: async () => {
      const response = await fetch('/api/test-plans');
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Network response was not ok for actual test plans' }));
        throw new Error(errorData.error || errorData.message || 'Failed to fetch actual test plans');
      }
      return response.json();
    },
  });

  const filteredUiTests = useMemo(() => {
    if (!uiTests) return [];
    return uiTests.filter(test =>
      test.name.toLowerCase().includes(uiTestSearchTerm.toLowerCase()) ||
      test.url.toLowerCase().includes(uiTestSearchTerm.toLowerCase()) ||
      (test.projectName && test.projectName.toLowerCase().includes(uiTestSearchTerm.toLowerCase()))
    );
  }, [uiTestSearchTerm, uiTests]);

  const filteredSchedules = useMemo(() => {
    if (!schedules) return [];
    return schedules.filter(schedule =>
      schedule.scheduleName.toLowerCase().includes(scheduleSearchTerm.toLowerCase())
    );
  }, [scheduleSearchTerm, schedules]);

  // Pagination for UI Tests Tab (formerly Test Plans)
  const totalUiTestPages = Math.ceil(filteredUiTests.length / itemsPerPage);
  const paginatedUiTests = filteredUiTests.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Effect to reset page number for UI Tests tab when search term changes
  useEffect(() => {
    setCurrentPage(1); // Reset main page state, now used by UI Tests tab
  }, [uiTestSearchTerm]);

  // Filtering and Pagination for API Tests Tab
  useEffect(() => {
    setCurrentApiTestPage(1); // Reset to first page on search term change
  }, [apiTestSearchTerm]);

  const filteredApiTests = useMemo(() => {
    if (!apiTestsData) return [];
    return apiTestsData.filter(test =>
      (test.name?.toLowerCase() || '').includes(apiTestSearchTerm.toLowerCase()) ||
      (test.method?.toLowerCase() || '').includes(apiTestSearchTerm.toLowerCase()) ||
      (test.url?.toLowerCase() || '').includes(apiTestSearchTerm.toLowerCase())
    );
  }, [apiTestSearchTerm, apiTestsData]);

  const totalApiTestPages = Math.ceil(filteredApiTests.length / apiItemsPerPage);
  const paginatedApiTests = useMemo(() => {
    return filteredApiTests.slice(
      (currentApiTestPage - 1) * apiItemsPerPage,
      currentApiTestPage * apiItemsPerPage
    );
  }, [filteredApiTests, currentApiTestPage, apiItemsPerPage]);


  // getStatusBadgeVariant is likely not needed for TestPlans, can be removed if TestItem interface is fully removed.
  // For now, keep it if TestItem structure is still used elsewhere or as a placeholder.
  const getStatusBadgeVariant = (status: string) => { // Simplified if used as placeholder
    switch (status) {
      case 'Pass': return 'default';
      case 'Fail': return 'destructive';
      case 'Pending': return 'secondary';
      case 'Running': return 'outline';
      default: return 'secondary';
    }
  };

  // --- Edit Modal Handlers & Mutation (Schedules) ---
  const handleOpenEditModal = (schedule: ScheduleItem) => {
    setEditingSchedule(schedule);
    setEditableScheduleName(schedule.scheduleName);
    setEditableScheduleTestPlanId(schedule.testPlanId || ''); // Use specific state for schedule's test plan ID
    // editableTestPlanName for schedule is derived, not directly set.
    setEditableFrequency(schedule.frequency);
    setEditableNextRunAt(formatTimestampToDateTimeLocal(schedule.nextRunAt));
    setIsEditModalOpen(true);
  };

  const editScheduleMutation = useMutation({
    // Updated to reflect that testPlanName is not part of ScheduleItem for PUT
    mutationFn: async (updatedScheduleData: { id: string, scheduleName?: string, testPlanId?: string | null, frequency?: string, nextRunAt?: number }) => {
      const { id, ...payload } = updatedScheduleData;
      const response = await fetch(`/api/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to update schedule and parse error response' }));
        throw new Error(errorData.message || 'Failed to update schedule');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      setIsEditModalOpen(false);
      setEditingSchedule(null);
    },
    onError: (error: Error) => {
      alert(`Error updating schedule: ${error.message}`);
      console.error("Error updating schedule:", error);
    },
  });

  const handleSaveChanges = () => { // For Schedules
    if (!editingSchedule) return;
    const nextRunAtTimestamp = Math.floor(getTime(parseISO(editableNextRunAt)) / 1000);
    editScheduleMutation.mutate({
      id: editingSchedule.id,
      scheduleName: editableScheduleName,
      testPlanId: editableScheduleTestPlanId.trim() || null, // Use specific state
      frequency: editableFrequency,
      nextRunAt: nextRunAtTimestamp,
    });
  };

  // --- Delete Confirmation Handlers & Mutation (Schedules) ---
  const handleOpenDeleteConfirm = (scheduleId: string) => {
    setDeletingScheduleId(scheduleId);
    setIsDeleteConfirmOpen(true);
  };

  const deleteScheduleMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      const response = await fetch(`/api/schedules/${scheduleId}`, {
        method: 'DELETE',
      });
      if (!response.ok) { // Status 204 is ok
        if (response.status === 204) return null; // Handle 204 No Content explicitly
        const errorData = await response.json().catch(() => ({ message: 'Failed to delete schedule and parse error response' }));
        throw new Error(errorData.message || `Failed to delete schedule. Status: ${response.status}`);
      }
      if (response.status === 204) return null;
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      setIsDeleteConfirmOpen(false);
      setDeletingScheduleId(null);
      // Potentially show success toast
    },
    onError: (error: Error) => {
      alert(`Error deleting schedule: ${error.message}`);
      console.error("Error deleting schedule:", error);
      // Ensure dialog closes even on error, or provide retry
      setIsDeleteConfirmOpen(false);
      setDeletingScheduleId(null);
    },
  });

  const handleConfirmDelete = () => {
    if (!deletingScheduleId) return;
    deleteScheduleMutation.mutate(deletingScheduleId);
  };

  // --- Create Schedule Modal Handlers & Mutation ---
  const openCreateScheduleModal = () => {
    setNewScheduleName('');
    setNewScheduleTestPlanId(actualTestPlans.length > 0 ? actualTestPlans[0].id : null); // Use actualTestPlans
    setNewFrequency('Daily');
    setNewNextRunAtString(formatTimestampToDateTimeLocal(Math.floor(Date.now() / 1000) + 3600));
    setIsCreateModalOpen(true);
  };

  const createScheduleMutation = useMutation({
    mutationFn: async (newScheduleData: { scheduleName: string, testPlanId: string, frequency: string, nextRunAt: number }) => { // testPlanId is string (not null)
      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newScheduleData),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to create schedule and parse error response' }));
        throw new Error(errorData.message || 'Failed to create schedule');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      setIsCreateModalOpen(false);
    },
    onError: (error: Error) => {
      alert(`Error creating schedule: ${error.message}`);
      console.error("Error creating schedule:", error);
    },
  });

  const handleCreateSchedule = () => {
    if (!newScheduleName.trim()) { alert("Schedule Name is required."); return; }
    if (!newScheduleTestPlanId) { alert("Test Plan is required for a schedule."); return; } // Check if null
    const nextRunAtTimestamp = Math.floor(getTime(parseISO(newNextRunAtString)) / 1000);
    createScheduleMutation.mutate({
      scheduleName: newScheduleName,
      testPlanId: newScheduleTestPlanId, // Already a string | null, POST expects string
      frequency: newFrequency,
      nextRunAt: nextRunAtTimestamp,
    });
  };

  // --- Test Plan CRUD ---
  const openCreateTestPlanModal = () => {
    setNewTestPlanNameState('');
    setNewTestPlanDescription('');
    setIsCreateTestPlanModalOpen(true);
  };

  const createTestPlanMutation = useMutation({
    mutationFn: async (newPlanData: { name: string, description?: string | null }) => {
      // Placeholder for actual API call
      console.log("Creating test plan with data:", newPlanData);
      const response = await fetch('/api/test-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPlanData),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to create test plan and parse error response' }));
        throw new Error(errorData.message || 'Failed to create test plan');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actualTestPlans'] });
      setIsCreateTestPlanModalOpen(false);
      // Potentially show success toast
    },
    onError: (error: Error) => {
      alert(`Error creating test plan: ${error.message}`);
      console.error("Error creating test plan:", error);
      // Modal remains open for user to correct or cancel
    },
  });

  const handleCreateTestPlan = () => {
    if (!newTestPlanNameState.trim()) {
      alert("Test Plan Name is required.");
      return;
    }
    createTestPlanMutation.mutate({
      name: newTestPlanNameState,
      description: newTestPlanDescription.trim() || null,
    });
  };
  // Placeholder for Edit/Delete Test Plan Modals and Mutations will be added progressively
  const handleOpenEditTestPlanModal = (plan: TestPlanItem) => {
    setEditingTestPlan(plan);
    setEditableTestPlanName(plan.name);
    setEditableTestPlanDescription(plan.description || '');
    setIsEditTestPlanModalOpen(true);
  };

  const editTestPlanMutation = useMutation({
    mutationFn: async (updatedPlanData: { id: string, name: string, description?: string | null }) => {
      const { id, ...payload } = updatedPlanData;
      const response = await fetch(`/api/test-plans/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to update test plan' }));
        throw new Error(errorData.message || 'Failed to update test plan');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actualTestPlans'] });
      setIsEditTestPlanModalOpen(false);
      setEditingTestPlan(null);
    },
    onError: (error: Error) => {
      alert(`Error updating test plan: ${error.message}`);
    }
  });

  const handleEditTestPlanSaveChanges = () => {
    if (!editingTestPlan || !editableTestPlanName.trim()) {
      alert("Test Plan Name is required.");
      return;
    }
    editTestPlanMutation.mutate({
      id: editingTestPlan.id,
      name: editableTestPlanName,
      description: editableTestPlanDescription.trim() || null,
    });
  };

  const handleOpenDeleteTestPlanConfirm = (planId: string) => {
    setDeletingTestPlanId(planId);
    setIsDeleteTestPlanConfirmOpen(true);
  };

  const deleteTestPlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      const response = await fetch(`/api/test-plans/${planId}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 204) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to delete test plan' }));
        throw new Error(errorData.message || 'Failed to delete test plan');
      }
      return null; // Or response.json() if backend returns data on delete
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actualTestPlans'] });
      setIsDeleteTestPlanConfirmOpen(false);
      setDeletingTestPlanId(null);
    },
    onError: (error: Error) => {
      alert(`Error deleting test plan: ${error.message}`);
      setIsDeleteTestPlanConfirmOpen(false); // Close dialog even on error
      setDeletingTestPlanId(null);
    }
  });

  const handleConfirmDeleteTestPlan = () => {
    if (!deletingTestPlanId) return;
    deleteTestPlanMutation.mutate(deletingTestPlanId);
  };

  // --- API Test Delete Mutation and Handlers ---
  const deleteApiTestMutation = useMutation({
    mutationFn: async (apiTestId: number) => {
      // Note: apiRequest is already set up to handle non-OK responses by throwing an error.
      // So, we don't need to explicitly check response.ok here if apiRequest is used.
      const response = await apiRequest('DELETE', `/api/api-tests/${apiTestId}`);
      // For DELETE, a 204 No Content is typical for success without a body.
      // apiRequest might return null or the response object itself on 204.
      // If it returns the response, and you need to ensure no JSON parsing is attempted on 204:
      if (response.status === 204) {
        return null;
      }
      // If apiRequest is configured to parse JSON, and DELETE might return JSON (e.g. the deleted object - though less common)
      // then this would be: return response.json();
      // For now, assuming 204 or error (which apiRequest handles)
      return null; // Or handle as per actual apiRequest behavior for 204
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiTestsList'] });
      toast({ title: t('testsPage.notifications.apiTestDeleted.title', 'API Test Deleted'), description: t('testsPage.notifications.apiTestDeleted.description', `Test "${deletingApiTestName}" has been deleted.`)});
      setIsDeleteApiTestConfirmOpen(false);
      setDeletingApiTestId(null);
      setDeletingApiTestName(null);
    },
    onError: (error: Error) => {
      toast({ title: t('testsPage.notifications.deleteFailed.title', 'Delete Failed'), description: error.message, variant: 'destructive' });
      setIsDeleteApiTestConfirmOpen(false);
      setDeletingApiTestId(null);
      setDeletingApiTestName(null);
    },
  });

  const handleConfirmDeleteApiTest = () => {
    if (!deletingApiTestId) return;
    deleteApiTestMutation.mutate(deletingApiTestId);
  };


  return (
    <div className="flex flex-col h-full">
      <header className="bg-card border-b border-border px-6 py-4">
        {/* Header content remains the same */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Link href="/dashboard" className="flex items-center space-x-2 text-primary hover:underline">
              <ArrowLeft className="w-4 h-5" />
            </Link>
            <FileText className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-card-foreground">{t('testsPage.testManagement.title')}</h1> {/* Updated Title */}
          </div>
          {/* Removed generic +Test button from main header */}
        </div>
      </header>

      <div className="p-6 flex-1 overflow-auto">
        {/* Tabs setup will be placed here, Test Plans controls will go into its TabContent */}
        <Tabs defaultValue="tests">
          <TabsList className="mb-4">
            <TabsTrigger value="tests">{t('testsPage.tests.label', 'Tests')}</TabsTrigger>
            <TabsTrigger value="api-tests">API Tests</TabsTrigger> {/* New API Tests Tab */}
            <TabsTrigger value="schedules">{t('testSuitesPage.schedules.label')}</TabsTrigger>
          </TabsList>

          {/* UI Tests Tab Content (formerly Test Plans) */}
          <TabsContent value="tests">
            <div className="flex flex-col md:flex-row justify-between items-center mb-6 space-y-4 md:space-y-0">
              <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
                <div className="relative w-full sm:w-auto">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder={t('testsPage.searchTests.placeholder', 'Search tests...')}
                    className="pl-8 pr-2 py-2 h-10 w-full sm:w-[200px] lg:w-[250px]"
                    value={uiTestSearchTerm}
                    onChange={(e) => { setUiTestSearchTerm(e.target.value); setCurrentPage(1); }}
                  />
                </div>
                <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => { setUiTestSearchTerm(''); setCurrentPage(1); }}>
                  <RefreshCcw size={18} />
                </Button>
                {/* Create Test Plan button removed - this tab now lists general UI tests */}
              </div>
              <div className="flex items-center gap-2"> {/* Pagination for UI Tests */}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft size={16} />
                </Button>
                <span className="mx-2 text-sm font-medium">
                  {`${Math.min((currentPage - 1) * itemsPerPage + 1, filteredUiTests.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1)}-${Math.min(currentPage * itemsPerPage, filteredUiTests.length)} of ${filteredUiTests.length}`}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentPage(prev => Math.min(totalUiTestPages, prev + 1))}
                  disabled={currentPage === totalUiTestPages || filteredUiTests.length === 0}
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
            {/* UI Tests Table Card (formerly Test Plans) */}
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('testsPage.uiTestTable.name', 'Name')}</TableHead>
                    <TableHead>{t('testsPage.uiTestTable.url', 'URL')}</TableHead>
                    <TableHead>{t('testsPage.uiTestTable.status', 'Status')}</TableHead>
                    <TableHead>{t('testsPage.uiTestTable.project', 'Project')}</TableHead>
                    <TableHead>{t('testsPage.uiTestTable.lastUpdated', 'Last Updated')}</TableHead>
                    <TableHead>{t('testsPage.uiTestTable.actions', 'Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingUiTests && (
                    <TableRow><TableCell colSpan={6} className="text-center">{t('testsPage.loadingUiTests.text', 'Loading tests...')}</TableCell></TableRow>
                  )}
                  {uiTestsError && (
                    <TableRow><TableCell colSpan={6} className="text-center text-red-500">{t('testsPage.errorLoadingUiTests.text', 'Error loading tests:')} {uiTestsError.message}</TableCell></TableRow>
                  )}
                  {!isLoadingUiTests && !uiTestsError && paginatedUiTests.map((test) => (
                    <TableRow key={test.id}>
                      <TableCell className="font-medium">{test.name}</TableCell>
                      <TableCell className="truncate max-w-xs" title={test.url}>{test.url}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(test.status)}>{test.status}</Badge>
                      </TableCell>
                      <TableCell>{test.projectName || t('testsPage.na.text', 'N/A')}</TableCell>
                      <TableCell>{test.updatedAt ? format(parseISO(test.updatedAt), 'yyyy-MM-dd HH:mm') : t('testsPage.na.text', 'N/A')}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => alert('View/Edit Test ID: ' + test.id)}>
                              <Play className="w-4 h-4 mr-2" />
                              {t('testsPage.viewEdit.button', 'View/Edit')}
                            </DropdownMenuItem>
                            {/* Add other actions like Delete here if needed in future */}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!isLoadingUiTests && !uiTestsError && paginatedUiTests.length === 0 && (
                     <TableRow><TableCell colSpan={6} className="text-center">{t('testsPage.noUiTestsFound.text', 'No tests found.')}</TableCell></TableRow>
                  )}
            </TableBody>
          </Table>
            </Card>
          </TabsContent>

          {/* API Tests Tab Content */}
          <TabsContent value="api-tests">
            <div className="flex flex-col md:flex-row justify-between items-center mb-6 space-y-4 md:space-y-0">
              <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
                <div className="relative w-full sm:w-auto">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder={t('testsPage.searchApiTests.placeholder', 'Search API tests...')}
                    className="pl-8 pr-2 py-2 h-10 w-full sm:w-[200px] lg:w-[250px]"
                    value={apiTestSearchTerm}
                    onChange={(e) => setApiTestSearchTerm(e.target.value)}
                  />
                </div>
                <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => { setApiTestSearchTerm(''); setCurrentApiTestPage(1); }}>
                  <RefreshCcw size={18} />
                </Button>
                {/* Optional: Add "Create API Test" button here later if needed */}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentApiTestPage(prev => Math.max(1, prev - 1))}
                  disabled={currentApiTestPage === 1}
                >
                  <ChevronLeft size={16} />
                </Button>
                <span className="mx-2 text-sm font-medium">
                  {`${Math.min((currentApiTestPage - 1) * apiItemsPerPage + 1, filteredApiTests.length === 0 ? 0 : (currentApiTestPage - 1) * apiItemsPerPage + 1)}-${Math.min(currentApiTestPage * apiItemsPerPage, filteredApiTests.length)} of ${filteredApiTests.length}`}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentApiTestPage(prev => Math.min(totalApiTestPages, prev + 1))}
                  disabled={currentApiTestPage === totalApiTestPages || filteredApiTests.length === 0}
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('testsPage.apiTestTable.name', 'Name')}</TableHead>
                    <TableHead>{t('testsPage.apiTestTable.method', 'Method')}</TableHead>
                    <TableHead>{t('testsPage.apiTestTable.url', 'URL')}</TableHead>
                    <TableHead>{t('testsPage.apiTestTable.project', 'Project')}</TableHead>
                    <TableHead>{t('testsPage.apiTestTable.creator', 'Creator')}</TableHead>
                    <TableHead>{t('testsPage.apiTestTable.lastUpdated', 'Last Updated')}</TableHead>
                    <TableHead>{t('testsPage.apiTestTable.actions', 'Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingApiTests && (
                    <TableRow><TableCell colSpan={7} className="text-center">{t('testsPage.loadingApiTests.text', 'Loading API tests...')}</TableCell></TableRow>
                  )}
                  {apiTestsError && (
                    <TableRow><TableCell colSpan={7} className="text-center text-red-500">{t('testsPage.errorLoadingApiTests.text', 'Error loading API tests:')} {apiTestsError.message}</TableCell></TableRow>
                  )}
                  {!isLoadingApiTests && !apiTestsError && paginatedApiTests.map((test) => (
                    <TableRow key={test.id}>
                      <TableCell className="font-medium">{test.name}</TableCell>
                      <TableCell>
                        <Badge variant={
                          test.method === 'GET' ? 'default' :
                          test.method === 'POST' ? 'secondary' : // Example: use different badge colors
                          test.method === 'PUT' ? 'outline' : // You might need to define these variants or use existing ones
                          test.method === 'DELETE' ? 'destructive' :
                          'info' // A 'info' variant or another default
                        }>{test.method}</Badge>
                      </TableCell>
                      <TableCell className="truncate max-w-xs" title={test.url}>{test.url}</TableCell>
                      <TableCell>{test.projectName || t('testsPage.na.text', 'N/A')}</TableCell>
                      <TableCell>{test.creatorUsername || t('testsPage.na.text', 'N/A')}</TableCell>
                      <TableCell>{test.updatedAt ? formatTimestampToReadableDate(getTime(parseISO(test.updatedAt as any))) : t('testsPage.na.text', 'N/A')}</TableCell>
                      <TableCell>
                        {/* Placeholder for Action Buttons */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setLocation(`/api-tester?testId=${test.id}`)}>
                              <Play className="w-4 h-4 mr-2" />
                              {t('testsPage.viewLoad.button', 'View/Load')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 hover:text-red-600 hover:bg-destructive/90 focus:text-red-600 focus:bg-destructive/90"
                              onClick={() => {
                                setDeletingApiTestId(test.id);
                                setDeletingApiTestName(test.name);
                                setIsDeleteApiTestConfirmOpen(true);
                              }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              {t('testsPage.delete.button', 'Delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!isLoadingApiTests && !apiTestsError && paginatedApiTests.length === 0 && (
                     <TableRow><TableCell colSpan={7} className="text-center">{t('testsPage.noApiTestsFound.text', 'No API tests found.')}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="schedules">
            <div className="flex justify-between items-center mb-6">
              <div className="flex space-x-2">
                <Button variant="outline" className="bg-green-100 text-green-800 hover:bg-green-200">
                  {t('testsPage.listView.button')}
                </Button>
                <Button variant="default" onClick={openCreateScheduleModal}> {/* Corrected onClick handler */}
                  <PlusCircle className="w-4 h-4 mr-2" />
                  {t('testsPage.createSchedule.button')}
                </Button>
              </div>
              <div className="relative w-full sm:w-auto max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder={t('testsPage.searchSchedules.placeholder')}
                  className="pl-8 pr-2 py-2 h-10 w-full"
                  value={scheduleSearchTerm}
                  onChange={(e) => setScheduleSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('testsPage.scheduleName.label')}</TableHead>
                    <TableHead>{t('testSuitesPage.testPlan.label')}</TableHead>
                    <TableHead>{t('testsPage.frequency.label')}</TableHead>
                    <TableHead>{t('testsPage.nextRunAt.label')}</TableHead>
                    <TableHead>{t('testsPage.actions.label')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingSchedules && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center">{t('testsPage.loadingSchedules.text')}</TableCell>
                    </TableRow>
                  )}
                  {schedulesError && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-red-500">
                        Error loading schedules: {schedulesError.message}
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoadingSchedules && !schedulesError && filteredSchedules.map((schedule) => (
                    <TableRow key={schedule.id}>
                      <TableCell className="font-medium">{schedule.scheduleName}</TableCell>
                      <TableCell>{schedule.testPlanName || schedule.testPlanId || 'N/A'}</TableCell>
                      <TableCell>{schedule.frequency}</TableCell>
                      <TableCell>{formatTimestampToReadableDate(schedule.nextRunAt)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end space-x-1">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleOpenEditModal(schedule)}>
                                <Edit3 className="w-4 h-4 mr-2" />
                                  {t('testsPage.edit.button')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-red-600 hover:text-red-600 hover:bg-destructive/90 focus:text-red-600 focus:bg-destructive/90"
                                onClick={() => handleOpenDeleteConfirm(schedule.id)}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                  {t('testsPage.delete.button')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create Schedule Modal */}
        <Dialog open={isCreateModalOpen} onOpenChange={(isOpen) => {
          setIsCreateModalOpen(isOpen);
          if (!isOpen) { /* Reset states if needed */ }
        }}>
          <DialogContent className="sm:max-w-[525px]">
            <DialogHeader>
              <DialogTitle>{t('testsPage.createNewSchedule.title')}</DialogTitle>
              <DialogDescription>
                {t('testsPage.fillInTheDetailsForYour.description')}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-6 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="newScheduleName" className="text-sm font-medium text-right col-span-1">{t('testSuitesPage.name.label')}<span className="text-red-500">*</span></label>
                <Input id="newScheduleName" value={newScheduleName} onChange={(e) => setNewScheduleName(e.target.value)} className="col-span-3 h-10" placeholder={t('testsPage.egDailySmokeTests.placeholder')} />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="newScheduleTestPlanId" className="text-sm font-medium text-right col-span-1">{t('testSuitesPage.testPlan.label')}<span className="text-red-500">*</span></label>
                <Select
                  value={newScheduleTestPlanId || ''}
                  onValueChange={(value) => setNewScheduleTestPlanId(value)}
                  disabled={isLoadingActualTestPlans || actualTestPlans.length === 0}
                >
                  <SelectTrigger className="col-span-3 h-10" id="newScheduleTestPlanId">
                    <SelectValue placeholder={isLoadingActualTestPlans ? t('testsPage.loadingTestPlans.text') : (actualTestPlans.length === 0 ? t('testsPage.noTestPlansAvailable.placeholder') : t('testsPage.selectATestPlan.placeholder'))} />
                  </SelectTrigger>
                  <SelectContent>
                    {isLoadingActualTestPlans ? (
                      <SelectItem value="loading" disabled>{t('testsPage.loadingTestPlans.text')}</SelectItem>
                    ) : actualTestPlans.length === 0 ? (
                      <SelectItem value="no-plans" disabled>{t('testsPage.noTestPlansAvailable.placeholder')}</SelectItem>
                    ) : (
                      actualTestPlans.map(plan => (
                        <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              {/* newTestPlanName input removed */}
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="newFrequency" className="text-sm font-medium text-right col-span-1">{t('testsPage.frequency.label')}<span className="text-red-500">*</span></label>
                <Select value={newFrequency} onValueChange={setNewFrequency}>
                  <SelectTrigger className="col-span-3 h-10">
                    <SelectValue placeholder={t('testsPage.selectFrequency.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Hourly">{t('testsPage.hourly.text')}</SelectItem>
                    <SelectItem value="Daily">{t('testsPage.daily.text')}</SelectItem>
                    <SelectItem value="Weekly">{t('testsPage.weekly.text')}</SelectItem>
                    <SelectItem value="Bi-Weekly">{t('testsPage.biweekly.text')}</SelectItem>
                    <SelectItem value="Monthly">{t('testsPage.monthly.text')}</SelectItem>
                    <SelectItem value="Every 15 minutes">{t('testsPage.every15Minutes.text')}</SelectItem>
                    <SelectItem value="Every 30 minutes">{t('testsPage.every30Minutes.text')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="newNextRunAt" className="text-sm font-medium text-right col-span-1">{t('testsPage.nextRunAt.label')}<span className="text-red-500">*</span></label>
                <Input id="newNextRunAt" type="datetime-local" value={newNextRunAtString} onChange={(e) => setNewNextRunAtString(e.target.value)} className="col-span-3 h-10" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>{t('testsPage.cancel.button')}</Button>
              <Button onClick={handleCreateSchedule} disabled={createScheduleMutation.isPending}>
                {createScheduleMutation.isPending ? t('testsPage.creating.button') : t('testsPage.createSchedule.button')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Schedule Modal (contents mostly unchanged, but actions will be updated) */}
        {editingSchedule && (
          <Dialog open={isEditModalOpen} onOpenChange={(isOpen) => {
            setIsEditModalOpen(isOpen);
            if (!isOpen) { setEditingSchedule(null); }
          }}>
            <DialogContent className="sm:max-w-[525px]">
              <DialogHeader>
                <DialogTitle>Edit Schedule: {editingSchedule.scheduleName}</DialogTitle>
                <DialogDescription>
                  {t('testsPage.updateTheFrequencyAndNextRun.description')}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <label className="text-sm font-medium text-right col-span-1">{t('testsPage.name.label1')}</label>
                  <p className="col-span-3 text-sm py-2">{editingSchedule.scheduleName}</p>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <label className="text-sm font-medium text-right col-span-1">{t('testSuitesPage.testPlan.label')}<span className="text-red-500">*</span>:</label>
                  <Select
                    value={editableScheduleTestPlanId}
                    onValueChange={(value) => setEditableScheduleTestPlanId(value)}
                    disabled={isLoadingActualTestPlans || actualTestPlans.length === 0}
                  >
                    <SelectTrigger className="col-span-3 h-10">
                      <SelectValue placeholder={isLoadingActualTestPlans ? t('testsPage.loadingTestPlans.text') : (actualTestPlans.length === 0 ? t('testsPage.noTestPlansAvailable.placeholder') : t('testsPage.selectATestPlan.placeholder'))} />
                    </SelectTrigger>
                    <SelectContent>
                      {isLoadingActualTestPlans ? (
                        <SelectItem value="loading" disabled>{t('testsPage.loadingTestPlans.text')}</SelectItem>
                      ) : actualTestPlans.length === 0 ? (
                        <SelectItem value="no-plans" disabled>{t('testsPage.noTestPlansAvailable.placeholder')}</SelectItem>
                      ) : (
                        actualTestPlans.map(plan => (
                          <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {/* Removed editableTestPlanName input, display derived name instead */}
                <div className="grid grid-cols-4 items-center gap-4">
                  <label className="text-sm font-medium text-right col-span-1">{t('testsPage.currentPlan.label')}</label>
                  <p className="col-span-3 text-sm py-2">{editingSchedule?.testPlanName || editableScheduleTestPlanId || t('testsPage.na.text')}</p>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <label htmlFor="editFrequency" className="text-sm font-medium text-right col-span-1">{t('testsPage.frequency.label1')}</label>
                  <Select value={editableFrequency} onValueChange={setEditableFrequency}>
                    <SelectTrigger className="col-span-3 h-10" id="editFrequency">
                      <SelectValue placeholder={t('testsPage.selectFrequency.placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                       {/* Options same as create modal */}
                      <SelectItem value="Hourly">{t('testsPage.hourly.text')}</SelectItem>
                      <SelectItem value="Daily">{t('testsPage.daily.text')}</SelectItem>
                      <SelectItem value="Weekly">{t('testsPage.weekly.text')}</SelectItem>
                      <SelectItem value="Bi-Weekly">{t('testsPage.biweekly.text')}</SelectItem>
                      <SelectItem value="Monthly">{t('testsPage.monthly.text')}</SelectItem>
                      <SelectItem value="Every 15 minutes">{t('testsPage.every15Minutes.text')}</SelectItem>
                      <SelectItem value="Every 30 minutes">{t('testsPage.every30Minutes.text')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <label htmlFor="editNextRunAt" className="text-sm font-medium text-right col-span-1">{t('testsPage.nextRunAt.label1')}</label>
                  <Input id="editNextRunAt" type="datetime-local" value={editableNextRunAt} onChange={(e) => setEditableNextRunAt(e.target.value)} className="col-span-3 h-10" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setIsEditModalOpen(false); setEditingSchedule(null); }}>{t('testsPage.cancel.button')}</Button>
                <Button onClick={handleSaveChanges} disabled={editScheduleMutation.isPending}>
                  {editScheduleMutation.isPending ? t('testsPage.saving.button') : t('testsPage.saveChanges.button')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={isDeleteConfirmOpen} onOpenChange={(isOpen) => {
            if (deleteScheduleMutation.isPending && isOpen) return; // Prevent closing while deleting
            setIsDeleteConfirmOpen(isOpen);
            if (!isOpen) { setDeletingScheduleId(null); }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('testsPage.confirmDeletion.title')}</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete schedule "{schedules.find(s => s.id === deletingScheduleId)?.scheduleName}"? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => { setIsDeleteConfirmOpen(false); setDeletingScheduleId(null); }}
                disabled={deleteScheduleMutation.isPending}
              >
                {t('testsPage.cancel.button')}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                disabled={deleteScheduleMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteScheduleMutation.isPending ? t('testsPage.deleting.button') : t('testsPage.delete.button')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Create Test Plan Modal */}
        <Dialog open={isCreateTestPlanModalOpen} onOpenChange={(isOpen) => {
          setIsCreateTestPlanModalOpen(isOpen);
          if (!isOpen) { /* Reset states if needed, e.g., form fields */ }
        }}>
          <DialogContent className="sm:max-w-[525px]">
            <DialogHeader>
              <DialogTitle>{t('testsPage.createNewTestPlan.title')}</DialogTitle>
              <DialogDescription>
                {t('testsPage.fillInTheDetailsForYourNewTestPlanName.description')}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-6 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="newTestPlanNameState" className="text-sm font-medium text-right col-span-1">{t('testSuitesPage.name.label')}<span className="text-red-500">*</span></label>
                <Input
                  id="newTestPlanNameState"
                  value={newTestPlanNameState}
                  onChange={(e) => setNewTestPlanNameState(e.target.value)}
                  className="col-span-3 h-10"
                  placeholder={t('testsPage.egEndtoendCheckoutFlow.placeholder')}
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="newTestPlanDescription" className="text-sm font-medium text-right col-span-1">{t('testsPage.description.label')}</label>
                <Input
                  id="newTestPlanDescription"
                  value={newTestPlanDescription}
                  onChange={(e) => setNewTestPlanDescription(e.target.value)}
                  className="col-span-3 h-10"
                  placeholder={t('testsPage.optionalABriefSummaryOfThe.placeholder')}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateTestPlanModalOpen(false)}>{t('testsPage.cancel.button')}</Button>
              <Button onClick={handleCreateTestPlan} disabled={createTestPlanMutation.isPending}>
                {createTestPlanMutation.isPending ? t('testsPage.creating.button') : t('testsPage.createTestPlan.button')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Test Plan Modal */}
        {editingTestPlan && (
          <Dialog open={isEditTestPlanModalOpen} onOpenChange={(isOpen) => {
            setIsEditTestPlanModalOpen(isOpen);
            if (!isOpen) setEditingTestPlan(null);
          }}>
            <DialogContent className="sm:max-w-[525px]">
              <DialogHeader>
                <DialogTitle>Edit Test Plan: {editingTestPlan.name}</DialogTitle>
                <DialogDescription>
                  {t('testsPage.updateTheNameAndDescription.description')}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <label htmlFor="editableTestPlanName" className="text-sm font-medium text-right col-span-1">{t('testSuitesPage.name.label')}<span className="text-red-500">*</span></label>
                  <Input
                    id="editableTestPlanName"
                    value={editableTestPlanName}
                    onChange={(e) => setEditableTestPlanName(e.target.value)}
                    className="col-span-3 h-10"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <label htmlFor="editableTestPlanDescription" className="text-sm font-medium text-right col-span-1">{t('testsPage.description.label')}</label>
                  <Input
                    id="editableTestPlanDescription"
                    value={editableTestPlanDescription}
                    onChange={(e) => setEditableTestPlanDescription(e.target.value)}
                    className="col-span-3 h-10"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setIsEditTestPlanModalOpen(false); setEditingTestPlan(null); }}>{t('testsPage.cancel.button')}</Button>
                <Button onClick={handleEditTestPlanSaveChanges} disabled={editTestPlanMutation.isPending}>
                  {editTestPlanMutation.isPending ? t('testsPage.saving.button') : t('testsPage.saveChanges.button')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Delete Test Plan Confirmation Dialog */}
        <AlertDialog open={isDeleteTestPlanConfirmOpen} onOpenChange={(isOpen) => {
            if (deleteTestPlanMutation.isPending && isOpen) return; // Prevent closing while deleting
            setIsDeleteTestPlanConfirmOpen(isOpen);
            if (!isOpen) setDeletingTestPlanId(null);
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('testsPage.confirmDeletion.title')}</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete test plan "{actualTestPlans.find(tp => tp.id === deletingTestPlanId)?.name}"?
                This action cannot be undone and will also delete any associated schedules.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => { setIsDeleteTestPlanConfirmOpen(false); setDeletingTestPlanId(null); }}
                disabled={deleteTestPlanMutation.isPending}
              >
                {t('testsPage.cancel.button')}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDeleteTestPlan}
                disabled={deleteTestPlanMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteTestPlanMutation.isPending ? t('testsPage.deleting.button') : t('testsPage.deleteTestPlan.button')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete API Test Confirmation Dialog */}
        <AlertDialog open={isDeleteApiTestConfirmOpen} onOpenChange={(isOpen) => {
          if (deleteApiTestMutation.isPending && isOpen) return;
          setIsDeleteApiTestConfirmOpen(isOpen);
          if (!isOpen) {
            setDeletingApiTestId(null);
            setDeletingApiTestName(null);
          }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('testsPage.confirmApiTestDeletion.title', 'Confirm API Test Deletion')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('testsPage.confirmApiTestDeletion.description', `Are you sure you want to delete the API test "${deletingApiTestName || ''}"? This action cannot be undone.`)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  setIsDeleteApiTestConfirmOpen(false);
                  setDeletingApiTestId(null);
                  setDeletingApiTestName(null);
                }}
                disabled={deleteApiTestMutation.isPending}
              >
                {t('testsPage.cancel.button', 'Cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDeleteApiTest}
                disabled={deleteApiTestMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteApiTestMutation.isPending ? t('testsPage.deleting.button', 'Deleting...') : t('testsPage.delete.button', 'Delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default TestsPage; // Changed export name
