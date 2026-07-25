import React from 'react';
import { useTranslation } from 'react-i18next';
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

import { FileTextIcon as ReportsIcon, Upload, Play } from 'lucide-react';

const TestManager: React.FC = () => {
  const { t } = useTranslation();

  // Custom Hooks Integration
  const { sequences } = useTestSequences();
  const { file, parsedTestCases, isUploading, handleFileChange, handleUpload } = useExcelImport();
  const { localMappings, handleMappingChange } = useExcelMappings();
  const { selectedIds, reportUrl, toggleSelection, runSelected } = useTestRunner(parsedTestCases, localMappings);

  return (
    <div className="mx-auto max-w-[1400px] p-6">
        <header className="mb-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('testManager.eyebrow', 'Excel import')}
                </div>
                <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{t('nav.testManager', 'Test Manager')}</h1>
              </div>
              <div className="flex gap-2">
                 <Input type="file" accept=".xlsx, .xls" onChange={handleFileChange} className="w-64" />
                 <Button onClick={handleUpload} disabled={isUploading || !file}>
                    <Upload className="mr-2 h-4 w-4" /> {isUploading ? t('testManager.uploading', 'Uploading…') : t('testManager.uploadExcel', 'Upload Excel')}
                 </Button>
              </div>
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
                 <Button asChild size="lg" className="shadow-md animate-in fade-in slide-in-from-bottom-4">
                     <a href={reportUrl} target="_blank" rel="noopener noreferrer">
                         <ReportsIcon className="mr-2 h-5 w-5" /> {t('testManager.viewLatestReport', 'View latest report')}
                     </a>
                 </Button>
            </div>
        )}
    </div>
  );
};

export default TestManager;
