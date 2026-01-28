import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

import { useTestSequences } from '@/hooks/useTestSequences';
import { useExcelImport } from '@/hooks/useExcelImport';
import { useExcelMappings } from '@/hooks/useExcelMappings';
import { useTestRunner } from '@/hooks/useTestRunner';

import {
  Home, PlusSquare, ListChecksIcon as TestsIcon, LibrarySquare as SuitesIcon,
  CalendarClock, FileTextIcon as ReportsIcon, Settings as SettingsIcon, Network,
  PanelLeftClose, PanelRightClose, TestTube,
  FileSpreadsheet, Upload, Play, 
} from 'lucide-react';

const TestManager: React.FC = () => {
  const { t } = useTranslation();
  // const { user } = useAuth(); // Not used directly in UI currently
  // const [location] = useLocation(); // Not used directly

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Custom Hooks Integration
  const { sequences } = useTestSequences();
  const { file, parsedTestCases, isUploading, handleFileChange, handleUpload } = useExcelImport();
  const { localMappings, handleMappingChange } = useExcelMappings();
  const { selectedIds, reportUrl, toggleSelection, runSelected } = useTestRunner(parsedTestCases, localMappings);

  // Sidebar Logic (Simplified Copy from DashboardOverviewPage)
  const linkBaseStyle = "flex items-center py-2 px-3 rounded-md text-sm font-medium";
  const activeLinkStyle = "bg-primary/10 text-primary";
  const inactiveLinkStyle = "text-foreground hover:bg-muted hover:text-foreground";
  const iconBaseStyle = "mr-3 h-5 w-5";
  // const collapsedIconStyle = "h-6 w-6";

  return (
    <div className="flex h-screen bg-background text-foreground">
       {/* Sidebar */}
      <aside className={`bg-card text-card-foreground border-r border-border shrink-0 flex flex-col transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'w-20 p-2' : 'w-64 p-4'}`}>
        <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'} p-1 mb-2 h-12`}>
            <div className="flex items-center">
              <TestTube className={`h-7 w-7 text-primary transition-all duration-300 ${isSidebarCollapsed ? 'ml-0' : 'mr-2'}`} />
              {!isSidebarCollapsed && <span className="font-semibold text-lg whitespace-nowrap">{t('dashboardOverviewPage.webtestPlatform.text', 'WebTest Platform')}</span>}
            </div>
            <Button variant="ghost" size="icon" onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}>
              {isSidebarCollapsed ? <PanelRightClose size={20} /> : <PanelLeftClose size={20} />}
            </Button>
        </div>
        <nav className={isSidebarCollapsed ? "mt-2" : "mt-0"}>
            <ul className="space-y-1">
                <li><Link href="/dashboard" className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${inactiveLinkStyle}`}><Home className={iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.dashboard')}</span>}</Link></li>
                <li><Link href="/dashboard/api-tester" className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${inactiveLinkStyle}`}><Network className={iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.apiTester', 'API Tester')}</span>}</Link></li>
                <li><Link href="/dashboard/create-test" className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${inactiveLinkStyle}`}><PlusSquare className={iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.createTest')}</span>}</Link></li>
                <li><Link href="/test-manager" className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${activeLinkStyle}`}><FileSpreadsheet className={iconBaseStyle} />{!isSidebarCollapsed && <span>Test Manager</span>}</Link></li>
                <li><Link href="/test-suites" className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${inactiveLinkStyle}`}><SuitesIcon className={iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.suites')}</span>}</Link></li>
                <li><Link href="/scheduling" className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${inactiveLinkStyle}`}><CalendarClock className={iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.scheduling')}</span>}</Link></li>
                <li><Link href="/reports" className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${inactiveLinkStyle}`}><ReportsIcon className={iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.reports')}</span>}</Link></li>
                <li><Link href="/settings" className={`${linkBaseStyle} ${isSidebarCollapsed ? 'justify-center' : ''} ${inactiveLinkStyle}`}><SettingsIcon className={iconBaseStyle} />{!isSidebarCollapsed && <span>{t('nav.settings')}</span>}</Link></li>
            </ul>
        </nav>
      </aside>

      <main className="flex-1 py-6 px-8 overflow-auto">
        <header className="mb-6 flex justify-between items-center">
            <h1 className="text-3xl font-bold">Test Manager</h1>
            <div className="flex gap-2">
                 <Input type="file" accept=".xlsx, .xls" onChange={handleFileChange} className="w-64" />
                 <Button onClick={handleUpload} disabled={isUploading || !file}>
                    <Upload className="mr-2 h-4 w-4" /> {isUploading ? "Uploading..." : "Upload Excel"}
                 </Button>
            </div>
        </header>

        <Card>
            <CardHeader>
                <CardTitle className="flex justify-between items-center">
                    <span>Parsed Test Cases</span>
                    <Button onClick={runSelected} disabled={selectedIds.size === 0}>
                        <Play className="mr-2 h-4 w-4" /> Run Selected ({selectedIds.size})
                    </Button>
                </CardTitle>
                <CardDescription>Map Excel rows to existing Test Sequences and execute them.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]">Select</TableHead>
                                <TableHead>Excel ID</TableHead>
                                <TableHead>Priority</TableHead>
                                <TableHead>Objective</TableHead>
                                <TableHead>Mapped Sequence</TableHead>
                                <TableHead>Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {parsedTestCases.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                                        No data. Upload an Excel file to start.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                parsedTestCases.map((tc) => (
                                    <TableRow key={tc.testCaseId}>
                                        <TableCell>
                                            <Checkbox 
                                                checked={selectedIds.has(tc.testCaseId)}
                                                onCheckedChange={() => toggleSelection(tc.testCaseId)}
                                            />
                                        </TableCell>
                                        <TableCell className="font-medium">{tc.testCaseId}</TableCell>
                                        <TableCell>{tc.priority}</TableCell>
                                        <TableCell className="max-w-md truncate" title={tc.functionalObjective}>{tc.functionalObjective}</TableCell>
                                        <TableCell>
                                            <Select 
                                                value={localMappings[tc.testCaseId]?.toString() || ""} 
                                                onValueChange={(val) => handleMappingChange(tc.testCaseId, val)}
                                            >
                                                <SelectTrigger className="w-[250px]">
                                                    <SelectValue placeholder="Select Sequence" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {sequences.map(seq => (
                                                        <SelectItem key={seq.id} value={seq.id.toString()}>
                                                            {seq.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-muted-foreground">-</span>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>

        {reportUrl && (
            <div className="fixed bottom-8 right-8">
                 <Button asChild size="lg" className="shadow-lg animate-in fade-in slide-in-from-bottom-4">
                     <a href={reportUrl} target="_blank" rel="noopener noreferrer">
                         <ReportsIcon className="mr-2 h-5 w-5" /> View Latest Report
                     </a>
                 </Button>
            </div>
        )}
      </main>
    </div>
  );
};

export default TestManager;
