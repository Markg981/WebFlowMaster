import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, MonitorSmartphone, CalendarDays, FileText, Play, Search, RefreshCcw, ChevronLeft, ChevronRight, ArrowLeft, LibrarySquare, Loader2 } from 'lucide-react';
import type { TestPlan } from '@shared/schema'; // Import TestPlan type
import CreateTestPlanWizard from '@/components/dashboard/CreateTestPlanWizard'; // Import the wizard

// Interface for the actual TestPlan data structure from backend (adjust if necessary based on actual API response)
// Using TestPlan type from @shared/schema directly is better.
// interface TestPlanItem extends TestPlan {
//   // Any client-side specific additions can go here, but TestPlan from schema should be the base
// }

const fetchTestPlans = async (): Promise<TestPlan[]> => {
  const response = await fetch('/api/test-plans');
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  return response.json();
};

const TestSuitesPage: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  // const [selectedProject, setSelectedProject] = useState('all'); // Project filter removed for now
  const [currentPage, setCurrentPage] = useState(1);
  const [isWizardOpen, setIsWizardOpen] = useState(false); // State for wizard visibility
  const itemsPerPage = 5;

  const { data: allTestPlans = [], isLoading, error } = useQuery<TestPlan[]>({
    queryKey: ['testPlans'],
    queryFn: fetchTestPlans,
  });

  const handlePlanCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['testPlans'] }); // Invalidate cache to refetch
  };

  // Project filter logic removed as 'project' is not part of TestPlan schema directly
  // const projectOptions = useMemo(() => {
  //   const projects = [...new Set(allTestPlans.map(plan => plan.project))].sort(); // Assuming project exists
  //   return ['all', ...projects];
  // }, [allTestPlans]);

  const filteredTestPlans = useMemo(() => {
    return allTestPlans.filter(plan => {
      const nameMatch = plan.name.toLowerCase().includes(searchTerm.toLowerCase());
      // const projectMatch = selectedProject === 'all' || plan.project === selectedProject; // Project matching removed
      return nameMatch; // Only name match for now
    });
  }, [allTestPlans, searchTerm]);

  const totalPages = Math.ceil(filteredTestPlans.length / itemsPerPage);
  const paginatedTestPlans = filteredTestPlans.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Reset current page if filters change and current page becomes invalid
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    } else if (currentPage === 0 && totalPages > 0) {
      setCurrentPage(1);
    } else if (filteredTestPlans.length === 0 && currentPage !==1) {
      setCurrentPage(1);
    }
  }, [filteredTestPlans.length, totalPages, currentPage]);


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
            {/* Project Select Dropdown - REMOVED */}
            {/*
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
            */}
            {/* Refresh Button */}
            <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => { setSearchTerm(''); setCurrentPage(1); /* setSelectedProject('all'); */ }}>
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
                disabled={currentPage === 1 || isLoading}
              >
                <ChevronLeft size={16} />
              </Button>
              <span className="mx-2">
                {isLoading ? '...' : `${Math.min((currentPage - 1) * itemsPerPage + 1, filteredTestPlans.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1)}-${Math.min(currentPage * itemsPerPage, filteredTestPlans.length)} of ${filteredTestPlans.length}`}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages || filteredTestPlans.length === 0 || isLoading}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
            {/* + Test Plan Button */}
            <Button className="bg-green-500 hover:bg-green-600 text-white" onClick={() => setIsWizardOpen(true)}>
              {t('testSuitesPage.testPlan.button')}
            </Button>
          </div>
        </div>

        <CreateTestPlanWizard
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          onPlanCreated={handlePlanCreated}
        />

        <Tabs defaultValue="test-plan">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="test-plan">{t('testSuitesPage.testPlan.label')}</TabsTrigger>
            <TabsTrigger value="schedules">{t('testSuitesPage.schedules.label')}</TabsTrigger>
          </TabsList>
          <TabsContent value="test-plan" className="mt-6">
            <>
            {isLoading && (
              <div className="flex justify-center items-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="ml-2">{t('testSuitesPage.loadingTestPlans.text')}</p>
              </div>
            )}
            {error && (
              <div className="text-red-500 text-center py-10">
                {t('testSuitesPage.errorLoadingTestPlans.text')}: {error.message}
              </div>
            )}
            {!isLoading && !error && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('testSuitesPage.name.label')}</TableHead>
                    <TableHead>{t('testSuitesPage.description.label')}</TableHead>
                    <TableHead>{t('testSuitesPage.testingType.label')}</TableHead>
                    {/* <TableHead>{t('testSuitesPage.progettoDiAppartenenza.label')}</TableHead> REMOVED */}
                    <TableHead>{t('testSuitesPage.azioni.label')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedTestPlans.length === 0 && !isLoading && (
                     <TableRow>
                        <TableCell colSpan={4} className="text-center py-10">
                          {t('testSuitesPage.noTestPlansFound.text')}
                        </TableCell>
                      </TableRow>
                  )}
                  {paginatedTestPlans.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div>{item.name}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs text-muted-foreground">
                          {item.description || t('testSuitesPage.noDescription.text')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-1">
                          <Settings size={16} />
                          <MonitorSmartphone size={16} />
                          <span>{t('testSuitesPage.crossBrowserTesting.text')}</span> {/* Static as per wizard Step 1 */}
                        </div>
                      </TableCell>
                      {/* <TableCell>{item.project}</TableCell> REMOVED */}
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
            </>
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
