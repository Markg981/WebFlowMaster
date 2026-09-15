import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FilePicker } from '@/components/ui/file-picker';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

import { useTestSequences } from '@/hooks/useTestSequences';
import { useExcelImport } from '@/hooks/useExcelImport';
import { useExcelMappings } from '@/hooks/useExcelMappings';
import { useTestRunner } from '@/hooks/useTestRunner';

import { FileTextIcon as ReportsIcon, Upload, Play, FileSpreadsheet } from 'lucide-react';

const TestManager: React.FC = () => {
  const { t } = useTranslation();

  // Custom Hooks Integration
  const { sequences } = useTestSequences();
  const { file, parsedTestCases, isUploading, handleFileChange, handleUpload } = useExcelImport();
  const { localMappings, handleMappingChange } = useExcelMappings();
  const { selectedIds, reportUrl, toggleSelection, runSelected } = useTestRunner(parsedTestCases, localMappings);

  const hasRows = parsedTestCases.length > 0;

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('testManager.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('testManager.subtitle')}</p>
        </div>
        {/* While the table is empty the empty state carries the file picker, so repeating it
            up here would put the same control on screen twice. */}
        {hasRows && (
          <div className="flex gap-2">
            <FilePicker accept=".xlsx,.xls" file={file} onChange={handleFileChange} className="w-72" />
            <Button onClick={handleUpload} disabled={isUploading || !file}>
              <Upload className="mr-2 h-4 w-4" />
              {isUploading ? t('testManager.uploading') : t('testManager.uploadExcel')}
            </Button>
          </div>
        )}
      </header>

      <Card className="overflow-hidden">
        {hasRows && (
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {t('testManager.rowCount', { count: parsedTestCases.length })}
            </p>
            <Button size="sm" onClick={runSelected} disabled={selectedIds.size === 0}>
              <Play className="mr-2 h-4 w-4" />
              {t('testManager.runSelected', { n: selectedIds.size })}
            </Button>
          </div>
        )}

        {hasRows ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">{t('testManager.columns.select')}</TableHead>
                <TableHead>{t('testManager.columns.excelId')}</TableHead>
                <TableHead>{t('testManager.columns.priority')}</TableHead>
                <TableHead>{t('testManager.columns.objective')}</TableHead>
                <TableHead>{t('testManager.columns.mappedSequence')}</TableHead>
                <TableHead>{t('testManager.columns.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parsedTestCases.map((tc) => (
                <TableRow key={tc.testCaseId}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(tc.testCaseId)}
                      onCheckedChange={() => toggleSelection(tc.testCaseId)}
                      aria-label={t('testManager.selectRow', { id: tc.testCaseId })}
                    />
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">{tc.testCaseId}</TableCell>
                  <TableCell>{tc.priority}</TableCell>
                  <TableCell className="max-w-md truncate" title={tc.functionalObjective}>{tc.functionalObjective}</TableCell>
                  <TableCell>
                    <Select
                      value={localMappings[tc.testCaseId]?.toString() || ""}
                      onValueChange={(val) => handleMappingChange(tc.testCaseId, val)}
                    >
                      <SelectTrigger className="w-[250px]">
                        <SelectValue placeholder={t('testManager.selectSequence')} />
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
                    <span className="text-muted-foreground">—</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          /* An empty screen is where a new user lands, so it says what to do next and
             offers the control to do it, rather than reporting that there is no data. */
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <FileSpreadsheet className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <div>
              <p className="font-medium">{t('testManager.empty.title')}</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {t('testManager.empty.description')}
              </p>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              <FilePicker
                accept=".xlsx,.xls"
                file={file}
                onChange={handleFileChange}
                className="w-80"
              />
              {file && (
                <Button onClick={handleUpload} disabled={isUploading}>
                  <Upload className="mr-2 h-4 w-4" />
                  {isUploading ? t('testManager.uploading') : t('testManager.uploadExcel')}
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {reportUrl && (
        <div className="fixed bottom-8 right-8">
          <Button asChild size="lg" className="shadow-md animate-in fade-in slide-in-from-bottom-4">
            <a href={reportUrl} target="_blank" rel="noopener noreferrer">
              <ReportsIcon className="mr-2 h-5 w-5" /> {t('testManager.viewLatestReport')}
            </a>
          </Button>
        </div>
      )}
    </div>
  );
};

export default TestManager;
