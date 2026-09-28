import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FilePicker } from '@/components/ui/file-picker';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { useTestSequences } from '@/hooks/useTestSequences';
import { useExcelImport } from '@/hooks/useExcelImport';
import { useExcelMappings } from '@/hooks/useExcelMappings';
import { useTestRunner, type RowResult } from '@/hooks/useTestRunner';

import { FileTextIcon as ReportsIcon, Upload, Play, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react';

/** What happened to a row's last run: an icon and a word, coloured by outcome. */
const RowStatusLabel: React.FC<{ result?: RowResult }> = ({ result }) => {
  const { t } = useTranslation();
  if (!result) return <span className="text-sm text-muted-foreground">{t('testManager.status.notRun')}</span>;
  const label = t(`testManager.status.${result.status}`);
  if (result.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
      </span>
    );
  }
  if (result.status === 'notMapped') return <span className="text-sm text-muted-foreground">{label}</span>;
  const passed = result.status === 'passed';
  const Icon = passed ? CheckCircle2 : result.status === 'failed' ? XCircle : AlertTriangle;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-medium ${passed ? 'text-success' : 'text-destructive'}`}
      title={result.error}
    >
      <Icon className="h-4 w-4" aria-hidden /> {label}
    </span>
  );
};

/** Whether a row's run has finished, so there is a report to open. */
const hasReport = (result?: RowResult) =>
  !!result && (result.status === 'passed' || result.status === 'failed' || result.status === 'error');

const TestManager: React.FC = () => {
  const { t } = useTranslation();

  // Custom Hooks Integration
  const { sequences } = useTestSequences();
  const { file, parsedTestCases, isUploading, handleFileChange, handleUpload } = useExcelImport();
  const { localMappings, handleMappingChange } = useExcelMappings();
  const { selectedIds, results, isRunning, toggleSelection, runSelected } = useTestRunner(parsedTestCases, localMappings);
  const [reportFor, setReportFor] = React.useState<string | null>(null);

  const hasRows = parsedTestCases.length > 0;
  const report = reportFor ? results[reportFor] : undefined;
  const reportSteps = report?.steps ?? [];
  const sequenceName = (testId?: number) => sequences.find((seq) => seq.id === testId)?.name ?? `#${testId}`;

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
            <Button size="sm" onClick={runSelected} disabled={selectedIds.size === 0 || isRunning}>
              {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
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
                        {/* An empty list opened as a sliver with nothing to pick, which read as
                            the page freezing; say why it is empty instead. */}
                        {sequences.length === 0 ? (
                          <p className="max-w-[240px] px-2 py-1.5 text-sm text-muted-foreground">
                            {t('testManager.noSequences')}
                          </p>
                        ) : (
                          sequences.map(seq => (
                            <SelectItem key={seq.id} value={seq.id.toString()}>
                              {seq.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-3">
                      <RowStatusLabel result={results[tc.testCaseId]} />
                      {hasReport(results[tc.testCaseId]) && (
                        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setReportFor(tc.testCaseId)}>
                          <ReportsIcon className="mr-1 h-4 w-4" aria-hidden /> {t('testManager.viewReport')}
                        </Button>
                      )}
                    </span>
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

      <Dialog open={!!report} onOpenChange={(open) => { if (!open) setReportFor(null); }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          {report && reportFor && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t('testManager.report.title', { id: reportFor, sequence: sequenceName(report.testId) })}
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="flex flex-wrap items-center gap-2">
                    <RowStatusLabel result={report} />
                    <span>
                      {t('testManager.report.summary', {
                        passed: reportSteps.filter((step) => step.status === 'passed').length,
                        total: reportSteps.length,
                        seconds: ((report.durationMs ?? 0) / 1000).toFixed(1),
                      })}
                    </span>
                  </div>
                </DialogDescription>
              </DialogHeader>
              {report.error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {report.error}
                </p>
              )}
              {reportSteps.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('testManager.report.noSteps')}</p>
              ) : (
                <ol className="space-y-3">
                  {reportSteps.map((step, index) => (
                    <li key={index} className="rounded-md border p-3">
                      <div className="flex items-start gap-2">
                        {step.status === 'passed'
                          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                          : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{index + 1}. {step.name}</p>
                          <p className="break-words text-sm text-muted-foreground">{step.error || step.details}</p>
                        </div>
                      </div>
                      {step.screenshot && (
                        <img
                          src={step.screenshot}
                          alt={t('testManager.report.screenshot', { n: index + 1 })}
                          className="mt-2 max-h-64 rounded border"
                          loading="lazy"
                        />
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TestManager;
