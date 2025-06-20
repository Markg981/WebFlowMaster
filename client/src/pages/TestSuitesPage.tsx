import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, MonitorSmartphone, CalendarDays, FileText, Play, Search, RefreshCcw, ChevronLeft, ChevronRight, ArrowLeft, LibrarySquare } from 'lucide-react';

interface TestPlanItem {
  id: string;
  name: string;
  project: string;
}

const mockTestPlans: TestPlanItem[] = [
  { id: '1', name: 'Test Suite Alpha', project: 'Progetto Apollo' },
  { id: '2', name: 'User Authentication Flow', project: 'Progetto Zeus' },
  { id: '3', name: 'Payment Gateway Integration', project: 'Progetto Hera' },
  { id: '4', name: 'API Performance Metrics', project: 'Progetto Apollo' },
  { id: '5', name: 'Frontend Accessibility Audit', project: 'Progetto Ares' },
  { id: '6', name: 'Database Stress Test', project: 'Progetto Zeus' },
  { id: '7', name: 'Security Vulnerability Scan', project: 'Progetto Hades' },
  { id: '8', name: 'Mobile Responsiveness Check', project: 'Progetto Ares' },
  { id: '9', name: 'Cross-browser Compatibility', project: 'Progetto Apollo' },
  { id: '10', name: 'Data Backup and Restore Test', project: 'Progetto Hades' },
];

const TestSuitesPage: React.FC = () => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProject, setSelectedProject] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const projectOptions = useMemo(() => {
    const projects = [...new Set(mockTestPlans.map(plan => plan.project))].sort();
    return ['all', ...projects];
  }, []); // Removed mockTestPlans from dependency array as it's constant

  const filteredTestPlans = useMemo(() => {
    return mockTestPlans.filter(plan => {
      const nameMatch = plan.name.toLowerCase().includes(searchTerm.toLowerCase());
      const projectMatch = selectedProject === 'all' || plan.project === selectedProject;
      return nameMatch && projectMatch;
    });
  }, [searchTerm, selectedProject]); // Removed mockTestPlans from dependency array

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
            {/* + Test Plan Button */}
            <Button className="bg-green-500 hover:bg-green-600 text-white">
              {t('testSuitesPage.testPlan.button')}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="test-plan">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="test-plan">{t('testSuitesPage.testPlan.label')}</TabsTrigger>
            <TabsTrigger value="schedules">{t('testSuitesPage.schedules.label')}</TabsTrigger>
          </TabsList>
          <TabsContent value="test-plan" className="mt-6">
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
                    <div className="text-xs text-muted-foreground">{t('testSuitesPage.noDescription.text')}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-1">
                      <Settings size={16} />
                      <MonitorSmartphone size={16} />
                      <span>{t('testSuitesPage.crossDeviceTesting.text')}</span>
                    </div>
                  </TableCell>
                  <TableCell>{item.project}</TableCell>
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
