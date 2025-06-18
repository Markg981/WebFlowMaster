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
  lastRun: string;
}

interface ScheduleItem {
  id: string;
  scheduleName: string;
  testPlanId: string | null;
  testPlanName: string | null;
  frequency: string;
  nextRunAt: number; // Unix timestamp (seconds)
  createdAt: number; // Unix timestamp (seconds)
  updatedAt: number | null; // Unix timestamp (seconds)
}

const initialMockTests: TestItem[] = [
  { id: '1', name: 'Login API Test', type: 'API Test', status: 'Pass', lastRun: '2023-10-26' },
  { id: '2', name: 'Homepage UI Load', type: 'UI Test', status: 'Fail', lastRun: '2023-10-25' },
  { id: '3', name: 'Payment Process', type: 'E2E Test', status: 'Pass', lastRun: '2023-10-26' },
  { id: '4', name: 'User Profile Update API', type: 'API Test', status: 'Pending', lastRun: 'N/A' },
  { id: '5', name: 'Product Search Performance', type: 'Performance Test', status: 'Running', lastRun: '2023-10-27' },
];

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
  const [mockTests, setMockTests] = useState<TestItem[]>(initialMockTests);

  const [searchTerm, setSearchTerm] = useState('');
  const [scheduleSearchTerm, setScheduleSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleItem | null>(null);
  // Edit modal form states
  const [editableScheduleName, setEditableScheduleName] = useState(''); // Although name is not editable in current modal
  const [editableTestPlanId, setEditableTestPlanId] = useState('');
  const [editableTestPlanName, setEditableTestPlanName] = useState('');
  const [editableFrequency, setEditableFrequency] = useState('');
  const [editableNextRunAt, setEditableNextRunAt] = useState(''); // This will store YYYY-MM-DDTHH:mm string

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(null);

  // Create Schedule Modal States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newScheduleName, setNewScheduleName] = useState('');
  const [newTestPlanId, setNewTestPlanId] = useState('');
  const [newTestPlanName, setNewTestPlanName] = useState('');
  const [newFrequency, setNewFrequency] = useState('Daily'); // Default frequency
  const [newNextRunAtString, setNewNextRunAtString] = useState(() => formatTimestampToDateTimeLocal(Math.floor(Date.now() / 1000) + 3600)); // Default to 1 hour from now

  // Fetch schedules using React Query
  const { data: schedules = [], isLoading: isLoadingSchedules, error: schedulesError } = useQuery<ScheduleItem[]>({
    queryKey: ['schedules'],
    queryFn: async () => {
      const response = await fetch('/api/schedules');
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      return response.json();
    },
  });

  const filteredTests = useMemo(() => {
    return mockTests.filter(test => {
      const nameMatch = test.name.toLowerCase().includes(searchTerm.toLowerCase());
      const typeMatch = test.type.toLowerCase().includes(searchTerm.toLowerCase());
      return nameMatch || typeMatch;
    });
  }, [searchTerm, mockTests]);

  const filteredSchedules = useMemo(() => {
    if (!schedules) return [];
    return schedules.filter(schedule =>
      schedule.scheduleName.toLowerCase().includes(scheduleSearchTerm.toLowerCase())
    );
  }, [scheduleSearchTerm, schedules]);

  const totalPages = Math.ceil(filteredTests.length / itemsPerPage);
  const paginatedTests = filteredTests.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const getStatusBadgeVariant = (status: TestItem['status']) => {
    switch (status) {
      case 'Pass': return 'default';
      case 'Fail': return 'destructive';
      case 'Pending': return 'secondary';
      case 'Running': return 'outline';
      default: return 'secondary';
    }
  };

  // --- Edit Modal Handlers & Mutation ---
  const handleOpenEditModal = (schedule: ScheduleItem) => {
    setEditingSchedule(schedule);
    setEditableScheduleName(schedule.scheduleName);
    setEditableTestPlanId(schedule.testPlanId || '');
    setEditableTestPlanName(schedule.testPlanName || '');
    setEditableFrequency(schedule.frequency);
    setEditableNextRunAt(formatTimestampToDateTimeLocal(schedule.nextRunAt));
    setIsEditModalOpen(true);
  };

  const editScheduleMutation = useMutation({
    mutationFn: async (updatedSchedule: Partial<ScheduleItem> & { id: string }) => {
      const { id, ...payload } = updatedSchedule;
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
      // Potentially show success toast
    },
    onError: (error: Error) => {
      alert(`Error updating schedule: ${error.message}`);
      console.error("Error updating schedule:", error);
    },
  });

  const handleSaveChanges = () => {
    if (!editingSchedule) return;

    const nextRunAtTimestamp = Math.floor(getTime(parseISO(editableNextRunAt)) / 1000);

    editScheduleMutation.mutate({
      id: editingSchedule.id,
      scheduleName: editableScheduleName, // Send original name if not editable, or updated if made editable
      testPlanId: editableTestPlanId.trim() || null,
      testPlanName: editableTestPlanName.trim() || null,
      frequency: editableFrequency,
      nextRunAt: nextRunAtTimestamp,
    });
  };

  // --- Delete Confirmation Handlers & Mutation ---
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
  const openCreateModal = () => {
    // Reset form fields to default/empty when opening
    setNewScheduleName('');
    setNewTestPlanId('');
    setNewTestPlanName('');
    setNewFrequency('Daily');
    setNewNextRunAtString(formatTimestampToDateTimeLocal(Math.floor(Date.now() / 1000) + 3600)); // Default to 1 hour from now
    setIsCreateModalOpen(true);
  };

  const createScheduleMutation = useMutation({
    mutationFn: async (newSchedule: Omit<ScheduleItem, 'id' | 'createdAt' | 'updatedAt'>) => {
      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSchedule),
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
      // Potentially show a success toast here
    },
    onError: (error: Error) => {
      // Potentially show an error toast here
      alert(`Error creating schedule: ${error.message}`);
      console.error("Error creating schedule:", error);
    },
  });

  const handleCreateSchedule = () => {
    if (!newScheduleName.trim()) {
      alert("Schedule Name is required.");
      return;
    }
    // Convert YYYY-MM-DDTHH:mm string to Unix timestamp (seconds)
    const nextRunAtTimestamp = Math.floor(getTime(parseISO(newNextRunAtString)) / 1000);

    createScheduleMutation.mutate({
      scheduleName: newScheduleName,
      testPlanId: newTestPlanId.trim() || null,
      testPlanName: newTestPlanName.trim() || null,
      frequency: newFrequency,
      nextRunAt: nextRunAtTimestamp,
      // id, createdAt, updatedAt are handled by backend or not needed for creation DTO
    });
  };


  return (
    <div className="flex flex-col h-full">
      <header className="bg-card border-b border-border px-6 py-4">
        {/* Header content remains the same */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Link href="/dashboard" className="flex items-center space-x-2 text-primary hover:underline">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <FileText className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-card-foreground">Tests</h1>
          </div>
          <div className="flex items-center space-x-2">
            <Link href="/dashboard/create-test">
              <Button variant="outline" className="bg-green-500 hover:bg-green-600 text-white">
                <PlusCircle className="w-4 h-4 mr-2" />
                + Test
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="p-6 flex-1 overflow-auto">
        {/* Top section for Test search and pagination - remains the same */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 space-y-4 md:space-y-0">
          <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
            <div className="relative w-full sm:w-auto">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search tests..."
                className="pl-8 pr-2 py-2 h-10 w-full sm:w-[200px] lg:w-[250px]"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              />
            </div>
            <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => { setSearchTerm(''); setCurrentPage(1); }}>
              <RefreshCcw size={18} />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center text-sm font-medium">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft size={16} />
              </Button>
              <span className="mx-2">
                {`${Math.min((currentPage - 1) * itemsPerPage + 1, filteredTests.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1)}-${Math.min(currentPage * itemsPerPage, filteredTests.length)} of ${filteredTests.length}`}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages || filteredTests.length === 0}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
        </div>

        <Tabs defaultValue="tests">
          <TabsList className="mb-4">
            <TabsTrigger value="tests">Tests</TabsTrigger>
            <TabsTrigger value="schedules">Schedules</TabsTrigger>
          </TabsList>
          <TabsContent value="tests">
            <Card>
              {/* Tests Table - remains the same */}
              <Table>
                <TableHeader>
                  <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead> {/* New Header */}
                <TableHead>Status</TableHead> {/* New Header */}
                <TableHead>Last Run</TableHead> {/* New Header */}
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedTests.map((item) => ( /* Changed to paginatedTests */
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium">{item.name}</div> {/* Display item.name */}
                    {/* Removed description part */}
                  </TableCell>
                  <TableCell>{item.type}</TableCell> {/* Display item.type */}
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(item.status)}> {/* Display item.status with Badge */}
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{item.lastRun}</TableCell> {/* Display item.lastRun */}
                  <TableCell>
                    <div className="flex items-center space-x-2"> {/* Kept flex for button alignment */}
                      <Button variant="ghost" size="icon" title="Run"> {/* Changed to ghost variant, icon size */}
                        <Play className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Schedule"> {/* Changed to ghost variant, icon size */}
                        <CalendarDays className="w-4 h-4" /> {/* Corrected icon name */}
                      </Button>
                      <Button variant="ghost" size="icon" title="Reports"> {/* Changed to ghost variant, icon size */}
                        <FileText className="w-4 h-4" /> {/* Corrected icon name */}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>
                            <Edit3 className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Copy className="w-4 h-4 mr-2" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600">
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
                <Button variant="default" onClick={openCreateModal}> {/* Changed variant to default for primary action */}
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
                <label htmlFor="newTestPlanId" className="text-sm font-medium text-right col-span-1">Test Plan ID</label>
                <Input id="newTestPlanId" value={newTestPlanId} onChange={(e) => setNewTestPlanId(e.target.value)} className="col-span-3 h-10" placeholder="Optional Test Plan ID" />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="newTestPlanName" className="text-sm font-medium text-right col-span-1">Test Plan Name</label>
                <Input id="newTestPlanName" value={newTestPlanName} onChange={(e) => setNewTestPlanName(e.target.value)} className="col-span-3 h-10" placeholder="Optional: e.g., Core API Suite" />
              </div>
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
                  <label className="text-sm font-medium text-right col-span-1">Test Plan ID:</label>
                  <Input value={editableTestPlanId} onChange={(e) => setEditableTestPlanId(e.target.value)} className="col-span-3 h-10" placeholder="Test Plan ID" />
                </div>
                 <div className="grid grid-cols-4 items-center gap-4">
                  <label className="text-sm font-medium text-right col-span-1">Test Plan Name:</label>
                  <Input value={editableTestPlanName} onChange={(e) => setEditableTestPlanName(e.target.value)} className="col-span-3 h-10" placeholder="Test Plan Name" />
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
      </div>
    </div>
  );
};

export default TestsPage; // Changed export name
