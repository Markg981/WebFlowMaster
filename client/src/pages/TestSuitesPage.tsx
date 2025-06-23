import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, MonitorSmartphone, CalendarDays, FileText, Play, Search, RefreshCcw, ChevronLeft, ChevronRight, ArrowLeft, LibrarySquare, PlusCircle } from 'lucide-react'; // Added PlusCircle
import { useQuery } from '@tanstack/react-query'; // Added for API calls
import { Dialog, DialogTrigger, DialogContent } from '@/components/ui/dialog'; // Added DialogContent
import CreateTestPlanWizard from '@/components/test-plan-wizard/CreateTestPlanWizard'; // Import the wizard

// Define the TestPlan type based on expected API response (adjust as needed)
interface TestPlan {
  id: string; // Assuming ID is a string (like UUID) from the backend
  name: string;
  description?: string | null; // Optional description
  // Placeholder for other fields that might come from the API or be relevant for display
  testLabType?: string; // Example: "Web Test Automator"
  project?: string; // Example: Could be a project name or ID
  // Add other fields from your testPlans schema as needed for display
  // e.g., createdAt, updatedAt if you want to show them
}

// API fetching function - replace with your actual API call logic
// API fetching function
const fetchTestPlans = async (): Promise<TestPlan[]> => {
  const response = await fetch('/api/test-plans');
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Network response was not ok' }));
    throw new Error(errorData.message || 'Failed to fetch test plans');
  }
  return response.json();
};


const TestSuitesPage: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient(); // Get queryClient instance
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState('all'); // This might need to adapt based on how projects are handled with real data
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;
  const [isWizardOpen, setIsWizardOpen] = useState(false); // State to control wizard modal

  // Fetch test plans using react-query
  const { data: testPlans = [], isLoading, error, refetch } = useQuery<TestPlan[]>({ // Added refetch
    queryKey: ['testPlans'],
    queryFn: fetchTestPlans,
  });

  const handleWizardClose = () => {
    setIsWizardOpen(false);
    // Invalidate and refetch the testPlans query when the wizard closes successfully
    // This ensures the list is updated with the newly created plan.
    queryClient.invalidateQueries({ queryKey: ['testPlans'] });
  };

  const projectOptions = useMemo(() => {
    // This will be dynamic based on fetched testPlans or a separate projects API endpoint
    if (isLoading || error || !testPlans.length) return ['all'];
    const projects = [...new Set(testPlans.filter(plan => plan.project).map(plan => plan.project!))].sort();
    return ['all', ...projects];
  }, [testPlans, isLoading, error]);

  const filteredTestPlans = useMemo(() => {
    if (isLoading || error) return [];
    return testPlans.filter(plan => {
      const nameMatch = plan.name.toLowerCase().includes(searchTerm.toLowerCase());
      // TODO: Adapt project filtering if `plan.project` is not directly available or needs mapping
      const projectMatch = selectedProject === 'all' || (plan.project && plan.project === selectedProject);
      return nameMatch && projectMatch;
    });
  }, [searchTerm, selectedProject, testPlans, isLoading, error]);

  const totalPages = Math.ceil(filteredTestPlans.length / itemsPerPage);
  const paginatedTestPlans = filteredTestPlans.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="flex flex-col h-full"> {/* MODIFIED: Outermost container */}
      {/* New Page Header START */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Link href="/dashboard" className="flex items-center space-x-2 text-primary hover:underline">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <LibrarySquare className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-card-foreground">{t('testSuitesPage.testSuites.title')}</h1>
          </div>
          <div className="flex items-center space-x-4">
            {/* Placeholder for right-side icons */}
          </div>
        </div>
      </header>
      {/* New Page Header END */}

      {/* Content Wrapper for controls and tabs */}
      <div className="p-6 flex-1 overflow-auto">
        {/* Existing Header with search, filter, + Test Plan button - THIS WILL BE MOVED/ADJUSTED IN NEXT STEP */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 space-y-4 md:space-y-0">
          {/* Left/Center part: Search, Filter, Refresh */}
          <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
            {/* Search Bar */}
            <div className="relative w-full sm:w-auto">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t('testSuitesPage.searchTests.placeholder')}
                className="pl-8 pr-2 py-2 h-10 w-full sm:w-[200px] lg:w-[250px]"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              />
            </div>
            {/* Project Select Dropdown */}
            <Select value={selectedProject} onValueChange={(value) => { setSelectedProject(value); setCurrentPage(1); }}>
              <SelectTrigger className="h-10 w-full sm:w-auto sm:min-w-[180px]">
                <SelectValue placeholder={t('testSuitesPage.filterByProject.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {projectOptions.map(project => (
                  <SelectItem key={project} value={project}>
                    {project === 'all' ? t('testSuitesPage.allProjects.text') : project}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Refresh Button */}
            <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => { setSearchTerm(''); setSelectedProject('all'); setCurrentPage(1); }}>
              <RefreshCcw size={18} />
            </Button>
          </div>

          {/* Right part: Pagination and + Test Plan Button */}
          <div className="flex items-center gap-2">
            {/* Pagination */}
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
                {`${Math.min((currentPage - 1) * itemsPerPage + 1, filteredTestPlans.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1)}-${Math.min(currentPage * itemsPerPage, filteredTestPlans.length)} of ${filteredTestPlans.length}`}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages || filteredTestPlans.length === 0}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
            {/* + Test Plan Button - Now triggers modal */}
            <Dialog open={isWizardOpen} onOpenChange={setIsWizardOpen}>
              <DialogTrigger asChild>
                <Button className="bg-green-500 hover:bg-green-600 text-white">
                  <PlusCircle size={18} className="mr-2" /> {t('testSuitesPage.testPlan.button')}
                </Button>
              </DialogTrigger>
              {/*
                Placeholder for CreateTestPlanWizard component.
              <DialogContent className="p-0 overflow-hidden max-w-[90vw] md:max-w-3xl lg:max-w-4xl xl:max-w-5xl h-auto max-h-[90vh]">
                {isWizardOpen && <CreateTestPlanWizard onClose={handleWizardClose} />}
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Tabs defaultValue="test-plan">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="test-plan">{t('testSuitesPage.testPlan.label')}</TabsTrigger>
            <TabsTrigger value="schedules">{t('testSuitesPage.schedules.label')}</TabsTrigger>
          </TabsList>
          <TabsContent value="test-plan" className="mt-6">
            {isLoading && <p>{t('testSuitesPage.loadingTestPlans.text')}</p>}
            {error && <p className="text-red-500">{t('testSuitesPage.errorLoadingTestPlans.text', { message: (error as Error).message })}</p>}
            {!isLoading && !error && testPlans.length === 0 && (
              <div className="text-center py-10">
                <p className="text-lg text-muted-foreground">{t('testSuitesPage.noTestPlansFound.text')}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  {t('testSuitesPage.getStartedByCreating.text')}
                </p>
                {/* Optionally, trigger the modal from here too if desired */}
                {/* <Button onClick={() => setIsWizardOpen(true)} className="mt-4">
                  <PlusCircle size={18} className="mr-2" /> {t('testSuitesPage.testPlan.button')}
                </Button> */}
              </div>
            )}
            {!isLoading && !error && testPlans.length > 0 && paginatedTestPlans.length === 0 && searchTerm && (
                 <div className="text-center py-10">
                    <p className="text-lg text-muted-foreground">{t('testSuitesPage.noTestPlansMatchSearch.text')}</p>
                    <p className="text-sm text-muted-foreground mt-2">
                    {t('testSuitesPage.tryDifferentSearch.text')}
                    </p>
                </div>
            )}
            {!isLoading && !error && paginatedTestPlans.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('testSuitesPage.name.label')}</TableHead>
                    <TableHead>{t('testSuitesPage.testLabType.label')}</TableHead>
                    <TableHead>{t('testSuitesPage.progettoDiAppartenenza.label')}</TableHead>
                    <TableHead>{t('testSuitesPage.azioni.label')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedTestPlans.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div>{item.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.description || t('testSuitesPage.noDescription.text')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-1">
                          <Settings size={16} />
                          <MonitorSmartphone size={16} />
                          {/* This should come from item.testLabType or a default */}
                          <span>{item.testLabType || t('testSuitesPage.crossDeviceTesting.text')}</span>
                        </div>
                      </TableCell>
                      <TableCell>{item.project || '-'}</TableCell>
                      <TableCell>
                        <div className="space-x-2">
                          <Button variant="outline" size="sm">
                            <CalendarDays size={16} className="mr-1" /> {t('testSuitesPage.schedule.button')}
                          </Button>
                          <Button variant="outline" size="sm">
                            <FileText size={16} className="mr-1" /> {t('testSuitesPage.reports.button')}
                          </Button>
                          <Button variant="outline" size="sm">
                            <Play size={16} className="mr-1" /> {t('testSuitesPage.run.button')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
          <TabsContent value="schedules" className="mt-6">
            {/* Content for Schedules tab will go here */}
            <p>{t('testSuitesPage.schedulesContentGoesHere.text')}</p>
          </TabsContent>
        </Tabs>
      </div> {/* End of Content Wrapper */}
    </div> /* ADDED: This closes the outermost div */
  );
};

export default TestSuitesPage;
