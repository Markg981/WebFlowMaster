import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'wouter';
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
  const queryClient = useQueryClient();
  // State for the "Tests" tab (now Test Plans)
  const [testPlanSearchTerm, setTestPlanSearchTerm] = useState('');
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

  // Fetch schedules using React Query
  const { data: schedules = [], isLoading: isLoadingSchedules, error: schedulesError } = useQuery<ScheduleItem[]>({
    queryKey: ['schedules'],
    queryFn: async () => { /* ... unchanged ... */ },
  });

  // Fetch Test Plans using React Query
  const { data: testPlans = [], isLoading: isLoadingTestPlans, error: testPlansError } = useQuery<TestPlanItem[]>({
    queryKey: ['testPlans'],
    queryFn: async () => {
      const response = await fetch('/api/test-plans');
      if (!response.ok) {
        throw new Error('Network response was not ok for test plans');
      }
      return response.json();
    },
  });

  const filteredTestPlans = useMemo(() => { // Renamed from filteredTests
    if (!testPlans) return [];
    return testPlans.filter(plan =>
      plan.name.toLowerCase().includes(testPlanSearchTerm.toLowerCase()) ||
      (plan.description && plan.description.toLowerCase().includes(testPlanSearchTerm.toLowerCase()))
    );
  }, [testPlanSearchTerm, testPlans]);

  const filteredSchedules = useMemo(() => {
    if (!schedules) return [];
    return schedules.filter(schedule =>
      schedule.scheduleName.toLowerCase().includes(scheduleSearchTerm.toLowerCase())
    );
  }, [scheduleSearchTerm, schedules]);

  // Pagination for Test Plans Tab
  const totalTestPlanPages = Math.ceil(filteredTestPlans.length / itemsPerPage);
  const paginatedTestPlans = filteredTestPlans.slice( // Renamed from paginatedTests
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

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
    setNewScheduleTestPlanId(testPlans.length > 0 ? testPlans[0].id : null); // Default to first test plan or null
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
      queryClient.invalidateQueries({ queryKey: ['testPlans'] });
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
      queryClient.invalidateQueries({ queryKey: ['testPlans'] });
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
      queryClient.invalidateQueries({ queryKey: ['testPlans'] });
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
            <h1 className="text-xl font-bold text-card-foreground">Test Management</h1> {/* Updated Title */}
          </div>
          {/* Removed generic +Test button from main header */}
        </div>
      </header>

      <div className="p-6 flex-1 overflow-auto">
        {/* Tabs setup will be placed here, Test Plans controls will go into its TabContent */}
        <Tabs defaultValue="tests">
          <TabsList className="mb-4">
            <TabsTrigger value="tests">Test Plans</TabsTrigger> {/* Renamed Tab */}
            <TabsTrigger value="schedules">Schedules</TabsTrigger>
          </TabsList>

          {/* Test Plans Tab Content */}
          <TabsContent value="tests">
            <div className="flex flex-col md:flex-row justify-between items-center mb-6 space-y-4 md:space-y-0"> {/* Control Group for Test Plans */}
              <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto"> {/* Search, Refresh, Create Button */}
                <div className="relative w-full sm:w-auto">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  {/* The erroneous <Input tag on the next line has been removed */}
                  <Input
                    type="search"
                    placeholder="Search test plans..."
                    className="pl-8 pr-2 py-2 h-10 w-full sm:w-[200px] lg:w-[250px]"
                    value={testPlanSearchTerm}
                    onChange={(e) => { setTestPlanSearchTerm(e.target.value); setCurrentPage(1); }}
                  />
                </div>
                <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => { setTestPlanSearchTerm(''); setCurrentPage(1); }}>
                  <RefreshCcw size={18} />
                </Button>
                <Button variant="default" onClick={openCreateTestPlanModal} className="h-10">
                  <PlusCircle className="w-4 h-4 mr-2" />
                  Create Test Plan
                </Button>
              </div>
              <div className="flex items-center gap-2"> {/* Pagination for Test Plans */}
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
                  {`${Math.min((currentPage - 1) * itemsPerPage + 1, filteredTestPlans.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1)}-${Math.min(currentPage * itemsPerPage, filteredTestPlans.length)} of ${filteredTestPlans.length}`}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCurrentPage(prev => Math.min(totalTestPlanPages, prev + 1))}
                  disabled={currentPage === totalTestPlanPages || filteredTestPlans.length === 0}
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
            {/* Test Plans Table Card */}
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Created At</TableHead>
                    <TableHead>Updated At</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingTestPlans && (
                    <TableRow><TableCell colSpan={5} className="text-center">Loading test plans...</TableCell></TableRow>
                  )}
                  {testPlansError && (
                    <TableRow><TableCell colSpan={5} className="text-center text-red-500">Error loading test plans: {testPlansError.message}</TableCell></TableRow>
                  )}
                  {!isLoadingTestPlans && !testPlansError && paginatedTestPlans.map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell className="font-medium">{plan.name}</TableCell>
                      <TableCell>{plan.description || 'N/A'}</TableCell>
                      <TableCell>{formatTimestampToReadableDate(plan.createdAt)}</TableCell>
                      <TableCell>{formatTimestampToReadableDate(plan.updatedAt)}</TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-1">
                          {/* Simplified Actions for Test Plans */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleOpenEditTestPlanModal(plan)}>
                                <Edit3 className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-red-600 hover:text-red-600 hover:bg-destructive/90 focus:text-red-600 focus:bg-destructive/90"
                                onClick={() => handleOpenDeleteTestPlanConfirm(plan.id)}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
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
          <TabsContent value="schedules">
            <div className="flex justify-between items-center mb-6">
              <div className="flex space-x-2">
                <Button variant="outline" className="bg-green-100 text-green-800 hover:bg-green-200">
                  List View
                </Button>
                <Button variant="default" onClick={openCreateScheduleModal}> {/* Corrected onClick handler */}
                  <PlusCircle className="w-4 h-4 mr-2" />
                  Create Schedule
                </Button>
              </div>
              <div className="relative w-full sm:w-auto max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search schedules..."
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
                    <TableHead>Schedule Name</TableHead>
                    <TableHead>Test Plan</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Next Run At</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingSchedules && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center">Loading schedules...</TableCell>
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
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-red-600 hover:text-red-600 hover:bg-destructive/90 focus:text-red-600 focus:bg-destructive/90"
                                onClick={() => handleOpenDeleteConfirm(schedule.id)}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
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
              <DialogTitle>Create New Schedule</DialogTitle>
              <DialogDescription>
                Fill in the details for your new schedule.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-6 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="newScheduleName" className="text-sm font-medium text-right col-span-1">Name<span className="text-red-500">*</span></label>
                <Input id="newScheduleName" value={newScheduleName} onChange={(e) => setNewScheduleName(e.target.value)} className="col-span-3 h-10" placeholder="e.g., Daily Smoke Tests" />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="newScheduleTestPlanId" className="text-sm font-medium text-right col-span-1">Test Plan<span className="text-red-500">*</span></label>
                <Select
                  value={newScheduleTestPlanId || ''}
                  onValueChange={(value) => setNewScheduleTestPlanId(value)}
                  disabled={isLoadingTestPlans || testPlans.length === 0}
                >
                  <SelectTrigger className="col-span-3 h-10" id="newScheduleTestPlanId">
                    <SelectValue placeholder={isLoadingTestPlans ? "Loading test plans..." : (testPlans.length === 0 ? "No test plans available" : "Select a Test Plan")} />
                  </SelectTrigger>
                  <SelectContent>
                    {isLoadingTestPlans ? (
                      <SelectItem value="loading" disabled>Loading...</SelectItem>
                    ) : testPlans.length === 0 ? (
                      <SelectItem value="no-plans" disabled>No test plans available</SelectItem>
                    ) : (
                      testPlans.map(plan => (
                        <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              {/* newTestPlanName input removed */}
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="newFrequency" className="text-sm font-medium text-right col-span-1">Frequency<span className="text-red-500">*</span></label>
                <Select value={newFrequency} onValueChange={setNewFrequency}>
                  <SelectTrigger className="col-span-3 h-10">
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Hourly">Hourly</SelectItem>
                    <SelectItem value="Daily">Daily</SelectItem>
                    <SelectItem value="Weekly">Weekly</SelectItem>
                    <SelectItem value="Bi-Weekly">Bi-Weekly</SelectItem>
                    <SelectItem value="Monthly">Monthly</SelectItem>
                    <SelectItem value="Every 15 minutes">Every 15 minutes</SelectItem>
                    <SelectItem value="Every 30 minutes">Every 30 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="newNextRunAt" className="text-sm font-medium text-right col-span-1">Next Run At<span className="text-red-500">*</span></label>
                <Input id="newNextRunAt" type="datetime-local" value={newNextRunAtString} onChange={(e) => setNewNextRunAtString(e.target.value)} className="col-span-3 h-10" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateSchedule} disabled={createScheduleMutation.isPending}>
                {createScheduleMutation.isPending ? "Creating..." : "Create Schedule"}
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
                  Update the frequency and next run time for your schedule. Name and Test Plan are not editable here.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <label className="text-sm font-medium text-right col-span-1">Name:</label>
                  <p className="col-span-3 text-sm py-2">{editingSchedule.scheduleName}</p>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <label className="text-sm font-medium text-right col-span-1">Test Plan<span className="text-red-500">*</span>:</label>
                  <Select
                    value={editableScheduleTestPlanId}
                    onValueChange={(value) => setEditableScheduleTestPlanId(value)}
                    disabled={isLoadingTestPlans || testPlans.length === 0}
                  >
                    <SelectTrigger className="col-span-3 h-10">
                      <SelectValue placeholder={isLoadingTestPlans ? "Loading test plans..." : (testPlans.length === 0 ? "No test plans available" : "Select a Test Plan")} />
                    </SelectTrigger>
                    <SelectContent>
                      {isLoadingTestPlans ? (
                        <SelectItem value="loading" disabled>Loading...</SelectItem>
                      ) : testPlans.length === 0 ? (
                        <SelectItem value="no-plans" disabled>No test plans available</SelectItem>
                      ) : (
                        testPlans.map(plan => (
                          <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {/* Removed editableTestPlanName input, display derived name instead */}
                <div className="grid grid-cols-4 items-center gap-4">
                  <label className="text-sm font-medium text-right col-span-1">Current Plan:</label>
                  <p className="col-span-3 text-sm py-2">{editingSchedule?.testPlanName || editableScheduleTestPlanId || 'N/A'}</p>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <label htmlFor="editFrequency" className="text-sm font-medium text-right col-span-1">Frequency:</label>
                  <Select value={editableFrequency} onValueChange={setEditableFrequency}>
                    <SelectTrigger className="col-span-3 h-10" id="editFrequency">
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                    <SelectContent>
                       {/* Options same as create modal */}
                      <SelectItem value="Hourly">Hourly</SelectItem>
                      <SelectItem value="Daily">Daily</SelectItem>
                      <SelectItem value="Weekly">Weekly</SelectItem>
                      <SelectItem value="Bi-Weekly">Bi-Weekly</SelectItem>
                      <SelectItem value="Monthly">Monthly</SelectItem>
                      <SelectItem value="Every 15 minutes">Every 15 minutes</SelectItem>
                      <SelectItem value="Every 30 minutes">Every 30 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <label htmlFor="editNextRunAt" className="text-sm font-medium text-right col-span-1">Next Run At:</label>
                  <Input id="editNextRunAt" type="datetime-local" value={editableNextRunAt} onChange={(e) => setEditableNextRunAt(e.target.value)} className="col-span-3 h-10" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setIsEditModalOpen(false); setEditingSchedule(null); }}>Cancel</Button>
                <Button onClick={handleSaveChanges} disabled={editScheduleMutation.isPending}>
                  {editScheduleMutation.isPending ? "Saving..." : "Save Changes"}
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
              <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete schedule "{schedules.find(s => s.id === deletingScheduleId)?.scheduleName}"? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => { setIsDeleteConfirmOpen(false); setDeletingScheduleId(null); }}
                disabled={deleteScheduleMutation.isPending}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                disabled={deleteScheduleMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteScheduleMutation.isPending ? "Deleting..." : "Delete"}
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
              <DialogTitle>Create New Test Plan</DialogTitle>
              <DialogDescription>
                Fill in the details for your new test plan. Name is required.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-6 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="newTestPlanNameState" className="text-sm font-medium text-right col-span-1">Name<span className="text-red-500">*</span></label>
                <Input
                  id="newTestPlanNameState"
                  value={newTestPlanNameState}
                  onChange={(e) => setNewTestPlanNameState(e.target.value)}
                  className="col-span-3 h-10"
                  placeholder="e.g., End-to-End Checkout Flow"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="newTestPlanDescription" className="text-sm font-medium text-right col-span-1">Description</label>
                <Input
                  id="newTestPlanDescription"
                  value={newTestPlanDescription}
                  onChange={(e) => setNewTestPlanDescription(e.target.value)}
                  className="col-span-3 h-10"
                  placeholder="Optional: A brief summary of the test plan"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateTestPlanModalOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateTestPlan} disabled={createTestPlanMutation.isPending}>
                {createTestPlanMutation.isPending ? "Creating..." : "Create Test Plan"}
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
                  Update the name and description for your test plan.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <label htmlFor="editableTestPlanName" className="text-sm font-medium text-right col-span-1">Name<span className="text-red-500">*</span></label>
                  <Input
                    id="editableTestPlanName"
                    value={editableTestPlanName}
                    onChange={(e) => setEditableTestPlanName(e.target.value)}
                    className="col-span-3 h-10"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <label htmlFor="editableTestPlanDescription" className="text-sm font-medium text-right col-span-1">Description</label>
                  <Input
                    id="editableTestPlanDescription"
                    value={editableTestPlanDescription}
                    onChange={(e) => setEditableTestPlanDescription(e.target.value)}
                    className="col-span-3 h-10"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setIsEditTestPlanModalOpen(false); setEditingTestPlan(null); }}>Cancel</Button>
                <Button onClick={handleEditTestPlanSaveChanges} disabled={editTestPlanMutation.isPending}>
                  {editTestPlanMutation.isPending ? "Saving..." : "Save Changes"}
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
              <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete test plan "{testPlans.find(tp => tp.id === deletingTestPlanId)?.name}"?
                This action cannot be undone and will also delete any associated schedules.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => { setIsDeleteTestPlanConfirmOpen(false); setDeletingTestPlanId(null); }}
                disabled={deleteTestPlanMutation.isPending}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDeleteTestPlan}
                disabled={deleteTestPlanMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteTestPlanMutation.isPending ? "Deleting..." : "Delete Test Plan"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default TestsPage; // Changed export name
