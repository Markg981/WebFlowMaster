import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { ArrowRight, ArrowLeft, PlusCircle, XCircle, ExternalLink, Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { v4 as uuidv4 } from 'uuid';
import TestSuiteSelectorModal from './TestSuiteSelectorModal';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface CreateTestPlanWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onPlanCreated: () => void;
}

const CreateTestPlanWizard: React.FC<CreateTestPlanWizardProps> = ({ isOpen, onClose, onPlanCreated }) => {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1 Data
  const [testPlanName, setTestPlanName] = useState('');
  const [description, setDescription] = useState('');
  const [testPlanNameError, setTestPlanNameError] = useState('');

  // Step 2 Data
  interface TestMachineConfig {
    id: string;
    os: string;
    osVersion: string;
    browserName: string;
    browserVersion: string;
    headless: boolean;
  }
  const [testMachines, setTestMachines] = useState<TestMachineConfig[]>([]);
  const [currentOs, setCurrentOs] = useState('');
  const [currentOsVersion, setCurrentOsVersion] = useState('');
  const [currentBrowserName, setCurrentBrowserName] = useState('chrome');
  const [currentBrowserVersion, setCurrentBrowserVersion] = useState('latest');
  const [currentHeadless, setCurrentHeadless] = useState(false);
  const [testMachineFormError, setTestMachineFormError] = useState<string | null>(null);
  const [currentOsVersionOptions, setCurrentOsVersionOptions] = useState<string[]>([]);

  const osOptions = ["windows", "macos", "linux"];
  const browserOptions = ["chrome", "firefox", "webkit", "edge"];

  const osVersionMap: Record<string, string[]> = {
    windows: ['11', '10', 'Server 2022', 'Server 2019', 'Server 2016', 'Other'],
    macos: ['Sonoma (14)', 'Ventura (13)', 'Monterey (12)', 'Big Sur (11)', 'Other'],
    linux: ['Ubuntu 22.04', 'Ubuntu 20.04', 'Debian 12', 'Fedora 39', 'CentOS Stream 9', 'Other'],
  };

  useEffect(() => {
    if (currentOs && osVersionMap[currentOs]) {
      const newOptions = osVersionMap[currentOs];
      setCurrentOsVersionOptions(newOptions);
      if (!newOptions.includes(currentOsVersion) || currentOsVersion === '') {
        setCurrentOsVersion(newOptions[0] || '');
      }
    } else {
      setCurrentOsVersionOptions([]);
      setCurrentOsVersion('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOs]);


  const handleAddTestMachine = () => {
    if (!currentOs || !currentOsVersion || !currentBrowserName || !currentBrowserVersion) {
      setTestMachineFormError(t('createTestPlanWizard.step2.validation.machineFieldsRequired', 'All machine configuration fields are required.'));
      return;
    }
    setTestMachines(prev => [...prev, {
      id: uuidv4(),
      os: currentOs, osVersion: currentOsVersion,
      browserName: currentBrowserName, browserVersion: currentBrowserVersion,
      headless: currentHeadless,
    }]);
    setTestMachineFormError(null);
    if (testMachines.length + 1 > 0 || selectedTestSuites.length > 0) setStep2ValidationError('');
  };

  const handleRemoveTestMachine = (idToRemove: string) => {
    setTestMachines(prev => prev.filter(machine => machine.id !== idToRemove));
  };

  interface SelectedTestSuite {
    id: number;
    name: string;
    type: 'ui' | 'api';
  }
  const [selectedTestSuites, setSelectedTestSuites] = useState<SelectedTestSuite[]>([]);
  const [isTestSuiteSelectorOpen, setIsTestSuiteSelectorOpen] = useState(false);

  const handleAddSuitesFromSelector = (suitesToAdd: SelectedTestSuite[]) => {
    const newSuites = suitesToAdd.filter(
      add => !selectedTestSuites.find(existing => existing.id === add.id && existing.type === add.type)
    );
    setSelectedTestSuites(prev => {
      const updatedSelection = [...prev, ...newSuites];
      if (updatedSelection.length > 0 || testMachines.length > 0) setStep2ValidationError('');
      return updatedSelection;
    });
  };

  const alreadySelectedSuiteIds = useMemo(() => {
    return selectedTestSuites.map(s => `${s.type}-${s.id}`);
  }, [selectedTestSuites]);

  // Step 3 Data
  const [captureScreenshots, setCaptureScreenshots] = useState('on_failed_steps');
  const [visualTestingEnabled, setVisualTestingEnabled] = useState(false);
  const [pageLoadTimeout, setPageLoadTimeout] = useState('30');
  const [elementTimeout, setElementTimeout] = useState('30');
  const [onMajorStepFailure, setOnMajorStepFailure] = useState('abort_and_run_next_test_case');
  const [onAbortedTestCase, setOnAbortedTestCase] = useState('delete_cookies_and_reuse_session');
  const [onTestSuitePreRequisiteFailure, setOnTestSuitePreRequisiteFailure] = useState('stop_execution');
  const [onTestCasePreRequisiteFailure, setOnTestCasePreRequisiteFailure] = useState('stop_execution');
  const [onTestStepPreRequisiteFailure, setOnTestStepPreRequisiteFailure] = useState('abort_and_run_next_test_case');
  const [reRunOnFailure, setReRunOnFailure] = useState('none');
  const [notificationSettings, setNotificationSettings] = useState({
    passed: true,
    failed: true,
    notExecuted: true,
    stopped: true,
  });
  const [pageLoadTimeoutError, setPageLoadTimeoutError] = useState('');
  const [elementTimeoutError, setElementTimeoutError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const totalSteps = 3;
  const [step2ValidationError, setStep2ValidationError] = useState('');

  const validateStep1 = () => {
    if (!testPlanName.trim()) {
      setTestPlanNameError(t('createTestPlanWizard.step1.validation.nameRequired', 'Test Plan Name is required.'));
      return false;
    }
    setTestPlanNameError('');
    return true;
  };

  const validateStep2 = () => {
    if (testMachines.length === 0 && selectedTestSuites.length === 0) {
      setStep2ValidationError(t('createTestPlanWizard.step2.validation.atLeastOneMachineOrSuite', 'Please add at least one machine configuration or select at least one test suite.'));
      return false;
    }
    setStep2ValidationError('');
    return true;
  };

  const validateStep3 = () => {
    let isValid = true;
    const pLoadTimeout = parseInt(pageLoadTimeout, 10);
    const elTimeout = parseInt(elementTimeout, 10);

    if (pageLoadTimeout.trim() === '' || isNaN(pLoadTimeout) || pLoadTimeout <= 0) {
      setPageLoadTimeoutError(t('createTestPlanWizard.step3.validation.pageLoadTimeoutRequired', 'Page Load Timeout must be a positive number.'));
      isValid = false;
    } else {
      setPageLoadTimeoutError('');
    }

    if (elementTimeout.trim() === '' || isNaN(elTimeout) || elTimeout <= 0) {
      setElementTimeoutError(t('createTestPlanWizard.step3.validation.elementTimeoutRequired', 'Element Timeout must be a positive number.'));
      isValid = false;
    } else {
      setElementTimeoutError('');
    }
    return isValid;
  };

  const handleNext = () => {
    if (currentStep === 1 && !validateStep1()) return;
    if (currentStep === 2 && !validateStep2()) return;
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleCreatePlan = async () => {
    setSubmitError(null);
    if (!validateStep1() || !validateStep2() || !validateStep3()) {
      if (!validateStep1()) setCurrentStep(1);
      else if (!validateStep2()) setCurrentStep(2);
      return;
    }

    setIsSubmitting(true);
    const planDataToSubmit = {
      name: testPlanName,
      description: description,
      testMachinesConfig: testMachines.map(({id, ...rest}) => rest),
      captureScreenshots,
      visualTestingEnabled,
      pageLoadTimeout: parseInt(pageLoadTimeout, 10),
      elementTimeout: parseInt(elementTimeout, 10),
      onMajorStepFailure,
      onAbortedTestCase,
      onTestSuitePreRequisiteFailure,
      onTestCasePreRequisiteFailure,
      onTestStepPreRequisiteFailure,
      reRunOnFailure,
      notificationSettings,
      selectedTests: selectedTestSuites.map(st => ({ id: st.id, type: st.type })),
    };

    try {
      const response = await fetch('/api/test-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(planDataToSubmit),
      });
      if (!response.ok) {
        let errorMsg = 'Failed to create test plan';
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorData.message || errorMsg;
          if (errorData.details) {
            errorMsg = `${errorMsg}: ${JSON.stringify(errorData.details.formErrors || errorData.details.fieldErrors || errorData.details)}`;
          }
        } catch (e) { /* ignore if response is not json */ }
        throw new Error(errorMsg);
      }
      onPlanCreated();
      onClose();
    } catch (error: any) {
      console.error("Failed to create test plan:", error);
      setSubmitError(error.message || 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <>
            <DialogTitle>{t('createTestPlanWizard.step1.title', 'Step 1: Create Test Plan')}</DialogTitle>
            <DialogDescription>{t('createTestPlanWizard.step1.description', 'Provide basic details for your new test plan.')}</DialogDescription>
            <div className="py-6 space-y-6">
              <div>
                <Label htmlFor="testPlanName">{t('createTestPlanWizard.step1.name.label', 'Test Plan Name')}</Label>
                <Input
                  id="testPlanName"
                  value={testPlanName}
                  onChange={(e) => {
                    setTestPlanName(e.target.value);
                    if (e.target.value.trim()) setTestPlanNameError('');
                  }}
                  placeholder={t('createTestPlanWizard.step1.name.placeholder', 'e.g., End-to-End Checkout Flow')}
                  className={testPlanNameError ? "border-red-500" : ""}
                />
                {testPlanNameError && <p className="text-sm text-red-500 mt-1">{testPlanNameError}</p>}
              </div>
              <div>
                <Label htmlFor="description">{t('createTestPlanWizard.step1.descriptionField.label', 'Description (Optional)')}</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('createTestPlanWizard.step1.descriptionField.placeholder', 'A brief summary of what this test plan covers.')}
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t('createTestPlanWizard.step1.testLab.label', 'Select Test Lab')}</Label>
                  <Input value="Web Test Automator" disabled className="mt-1 bg-muted" />
                </div>
                <div>
                  <Label>{t('createTestPlanWizard.step1.testingType.label', 'Testing Type')}</Label>
                  <Input value="Cross Browser Testing" disabled className="mt-1 bg-muted" />
                </div>
              </div>
            </div>
          </>
        );
      case 2:
        return (
          <>
            <DialogTitle>{t('createTestPlanWizard.step2.title', 'Step 2: Test Machines & Suites')}</DialogTitle>
            <DialogDescription>{t('createTestPlanWizard.step2.description', 'Configure test machines and select test suites.')}</DialogDescription>
            <div className="py-6 space-y-8">
              <section>
                <h3 className="text-lg font-semibold mb-3">{t('createTestPlanWizard.step2.testMachinesConfig.title', 'Test Machines Configuration')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 border rounded-md">
                  <div className="space-y-1">
                    <Label htmlFor="os">{t('createTestPlanWizard.step2.os.label', 'Operating System')}</Label>
                    <Select value={currentOs} onValueChange={setCurrentOs}>
                      <SelectTrigger id="os"><SelectValue placeholder={t('createTestPlanWizard.step2.os.placeholder', 'Select OS')} /></SelectTrigger>
                      <SelectContent>{osOptions.map(osKey => <SelectItem key={osKey} value={osKey}>{osKey.charAt(0).toUpperCase() + osKey.slice(1)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="osVersion">{t('createTestPlanWizard.step2.osVersion.label', 'OS Version')}</Label>
                    <Select value={currentOsVersion} onValueChange={setCurrentOsVersion} disabled={!currentOs || currentOsVersionOptions.length === 0}>
                      <SelectTrigger id="osVersion"><SelectValue placeholder={t('createTestPlanWizard.step2.osVersion.placeholderSelect', 'Select Version')} /></SelectTrigger>
                      <SelectContent>
                        {currentOsVersionOptions.map(version => <SelectItem key={version} value={version}>{version}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="browserName">{t('createTestPlanWizard.step2.browser.label', 'Browser')}</Label>
                    <Select value={currentBrowserName} onValueChange={setCurrentBrowserName}>
                      <SelectTrigger id="browserName"><SelectValue placeholder={t('createTestPlanWizard.step2.browser.placeholder', 'Select Browser')} /></SelectTrigger>
                      <SelectContent>{browserOptions.map(b => <SelectItem key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="browserVersion">{t('createTestPlanWizard.step2.browserVersion.label', 'Browser Version')}</Label>
                    <Input id="browserVersion" value={currentBrowserVersion} onChange={e => setCurrentBrowserVersion(e.target.value)} placeholder={t('createTestPlanWizard.step2.browserVersion.placeholder', 'e.g., latest, 120.0')} />
                  </div>
                  <div className="flex items-center space-x-2 pt-5">
                    <Switch id="headless" checked={currentHeadless} onCheckedChange={setCurrentHeadless} />
                    <Label htmlFor="headless">{t('createTestPlanWizard.step2.headless.label', 'Headless')}</Label>
                  </div>
                  <div className="lg:col-span-1 flex items-end pb-1">
                     <Button variant="link" className="p-0 h-auto text-xs" onClick={() => alert(t('createTestPlanWizard.step2.desiredCapabilities.alertNotImplemented', 'Desired Capabilities configuration is not yet implemented.'))}>
                        {t('createTestPlanWizard.step2.desiredCapabilities.link', 'Desired Capabilities (Optional)')}
                        <ExternalLink className="ml-1 h-3 w-3" />
                    </Button>
                  </div>
                </div>
                {testMachineFormError && <p className="text-sm text-red-500 mt-2">{testMachineFormError}</p>}
                <Button onClick={handleAddTestMachine} variant="outline" size="sm" className="mt-3">
                  <PlusCircle className="mr-2 h-4 w-4" /> {t('createTestPlanWizard.step2.addMachineButton', 'Add Machine Configuration')}
                </Button>
                {testMachines.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <h4 className="font-medium text-sm">{t('createTestPlanWizard.step2.addedMachines.title', 'Added Configurations:')}</h4>
                    <ScrollArea className="h-[100px] w-full rounded-md border p-2">
                      {testMachines.map((machine) => (
                        <div key={machine.id} className="flex justify-between items-center p-1.5 border-b last:border-b-0 text-xs hover:bg-muted/50">
                          <span>{machine.os} {machine.osVersion} - {machine.browserName} {machine.browserVersion} ({machine.headless ? 'Headless' : 'UI'})</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemoveTestMachine(machine.id)}>
                            <XCircle className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      ))}
                    </ScrollArea>
                  </div>
                )}
              </section>
              <section>
                <h3 className="text-lg font-semibold mb-3">{t('createTestPlanWizard.step2.testSuitesSelection.title', 'Test Suites Selection')}</h3>
                <div className="p-4 border rounded-md min-h-[100px]">
                  {selectedTestSuites.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('createTestPlanWizard.step2.noTestSuitesSelected', 'No test suites selected yet.')}</p>
                  ) : (
                    <ul className="space-y-1 list-disc list-inside">
                      {selectedTestSuites.map(suite => (
                        <li key={`${suite.type}-${suite.id}`} className="text-sm">
                          {suite.name} <span className="text-xs uppercase bg-muted px-1 py-0.5 rounded">{suite.type}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                   <Button onClick={() => setIsTestSuiteSelectorOpen(true)} variant="outline" size="sm" className="mt-3">
                    <PlusCircle className="mr-2 h-4 w-4" /> {t('createTestPlanWizard.step2.addTestSuitesButton', 'Add Test Suites')}
                  </Button>
                </div>
                 {step2ValidationError && <p className="text-sm font-medium text-red-500 mt-2 text-center">{step2ValidationError}</p>}
              </section>
            </div>
            <TestSuiteSelectorModal
              isOpen={isTestSuiteSelectorOpen}
              onClose={() => setIsTestSuiteSelectorOpen(false)}
              onAddTestSuites={handleAddSuitesFromSelector}
              alreadySelectedIds={alreadySelectedSuiteIds}
            />
          </>
        );
      case 3:
        return (
          <>
            <DialogTitle>{t('createTestPlanWizard.step3.title', 'Step 3: Test Plan Settings')}</DialogTitle>
            <DialogDescription>{t('createTestPlanWizard.step3.description', 'Adjust advanced settings for the test plan execution.')}</DialogDescription>
            <div className="py-6 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <Label htmlFor="captureScreenshots">{t('createTestPlanWizard.step3.captureScreenshots.label', 'Capture Screenshots')}</Label>
                <Select value={captureScreenshots} onValueChange={setCaptureScreenshots}>
                  <SelectTrigger id="captureScreenshots"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">{t('createTestPlanWizard.step3.captureScreenshots.options.always', 'Always')}</SelectItem>
                    <SelectItem value="on_failed_steps">{t('createTestPlanWizard.step3.captureScreenshots.options.on_failed_steps', 'On Failed Steps (default)')}</SelectItem>
                    <SelectItem value="never">{t('createTestPlanWizard.step3.captureScreenshots.options.never', 'Never')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('createTestPlanWizard.step1.testingType.label', 'Testing Type')}</Label>
                <Input value="Cross Browser Testing" disabled className="mt-1 bg-muted" />
              </div>
              <div className="flex items-center space-x-2 mt-2 md:mt-0 md:pt-6">
                <Switch id="visualTesting" checked={visualTestingEnabled} onCheckedChange={setVisualTestingEnabled} />
                <Label htmlFor="visualTesting">{t('createTestPlanWizard.step3.visualTesting.label', 'Visual Testing (Experimental)')}</Label>
              </div>
              <div></div>
              <div>
                <Label htmlFor="pageLoadTimeout">{t('createTestPlanWizard.step3.pageLoadTimeout.label', 'Page Load Timeout (seconds)')}</Label>
                <Input id="pageLoadTimeout" type="number" value={pageLoadTimeout} onChange={e => setPageLoadTimeout(e.target.value)} placeholder="30" />
                {pageLoadTimeoutError && <p className="text-sm text-red-500 mt-1">{pageLoadTimeoutError}</p>}
              </div>
              <div>
                <Label htmlFor="elementTimeout">{t('createTestPlanWizard.step3.elementTimeout.label', 'Element Timeout (seconds)')}</Label>
                <Input id="elementTimeout" type="number" value={elementTimeout} onChange={e => setElementTimeout(e.target.value)} placeholder="30" />
                {elementTimeoutError && <p className="text-sm text-red-500 mt-1">{elementTimeoutError}</p>}
              </div>
              <div>
                <Label htmlFor="onMajorStepFailure">{t('createTestPlanWizard.step3.onMajorStepFailure.label', 'On Major Step Failure')}</Label>
                <Select value={onMajorStepFailure} onValueChange={setOnMajorStepFailure}>
                  <SelectTrigger id="onMajorStepFailure"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="abort_and_run_next_test_case">{t('createTestPlanWizard.step3.onMajorStepFailure.options.abort_run_next', 'Abort and run next Test Case (default)')}</SelectItem>
                    <SelectItem value="stop_execution">{t('createTestPlanWizard.step3.onMajorStepFailure.options.stop', 'Stop Execution')}</SelectItem>
                    <SelectItem value="retry_step">{t('createTestPlanWizard.step3.onMajorStepFailure.options.retry', 'Retry Step')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="onAbortedTestCase">{t('createTestPlanWizard.step3.onAbortedTestCase.label', 'On Aborted Test Case')}</Label>
                <Select value={onAbortedTestCase} onValueChange={setOnAbortedTestCase}>
                  <SelectTrigger id="onAbortedTestCase"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delete_cookies_and_reuse_session">{t('createTestPlanWizard.step3.onAbortedTestCase.options.delete_cookies_reuse_session', 'Delete cookies and reuse session (default)')}</SelectItem>
                    <SelectItem value="stop_execution">{t('createTestPlanWizard.step3.onAbortedTestCase.options.stop', 'Stop Execution')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="onTestSuitePreRequisiteFailure">{t('createTestPlanWizard.step3.onTestSuitePreRequisiteFailure.label', 'On Test Suite Pre Requisite Failure')}</Label>
                <Select value={onTestSuitePreRequisiteFailure} onValueChange={setOnTestSuitePreRequisiteFailure}>
                  <SelectTrigger id="onTestSuitePreRequisiteFailure"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stop_execution">{t('createTestPlanWizard.step3.onTestSuitePreRequisiteFailure.options.stop', 'Stop Execution (default)')}</SelectItem>
                    <SelectItem value="skip_test_suite">{t('createTestPlanWizard.step3.onTestSuitePreRequisiteFailure.options.skip_suite', 'Skip Test Suite')}</SelectItem>
                    <SelectItem value="continue_anyway">{t('createTestPlanWizard.step3.onTestSuitePreRequisiteFailure.options.continue', 'Continue Anyway')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="onTestCasePreRequisiteFailure">{t('createTestPlanWizard.step3.onTestCasePreRequisiteFailure.label', 'On Test Case Pre Requisite Failure')}</Label>
                <Select value={onTestCasePreRequisiteFailure} onValueChange={setOnTestCasePreRequisiteFailure}>
                  <SelectTrigger id="onTestCasePreRequisiteFailure"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stop_execution">{t('createTestPlanWizard.step3.onTestCasePreRequisiteFailure.options.stop', 'Stop Execution (default)')}</SelectItem>
                    <SelectItem value="skip_test_case">{t('createTestPlanWizard.step3.onTestCasePreRequisiteFailure.options.skip_case', 'Skip Test Case')}</SelectItem>
                    <SelectItem value="continue_anyway">{t('createTestPlanWizard.step3.onTestCasePreRequisiteFailure.options.continue', 'Continue Anyway')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="onTestStepPreRequisiteFailure">{t('createTestPlanWizard.step3.onTestStepPreRequisiteFailure.label', 'On Test Step Pre Requisite Failure')}</Label>
                <Select value={onTestStepPreRequisiteFailure} onValueChange={setOnTestStepPreRequisiteFailure}>
                  <SelectTrigger id="onTestStepPreRequisiteFailure"><SelectValue /></SelectTrigger>
                  <SelectContent>
                     <SelectItem value="abort_and_run_next_test_case">{t('createTestPlanWizard.step3.onTestStepPreRequisiteFailure.options.abort_run_next', 'Abort and run next Test Case (default)')}</SelectItem>
                    <SelectItem value="stop_execution">{t('createTestPlanWizard.step3.onTestStepPreRequisiteFailure.options.stop', 'Stop Execution')}</SelectItem>
                    <SelectItem value="skip_test_step">{t('createTestPlanWizard.step3.onTestStepPreRequisiteFailure.options.skip_step', 'Skip Test Step')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="reRunOnFailure">{t('createTestPlanWizard.step3.reRunOnFailure.label', 'Re-Run On Failure')}</Label>
                <Select value={reRunOnFailure} onValueChange={setReRunOnFailure}>
                  <SelectTrigger id="reRunOnFailure"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('createTestPlanWizard.step3.reRunOnFailure.options.none', 'None (default)')}</SelectItem>
                    <SelectItem value="once">{t('createTestPlanWizard.step3.reRunOnFailure.options.once', 'Once')}</SelectItem>
                    <SelectItem value="twice">{t('createTestPlanWizard.step3.reRunOnFailure.options.twice', 'Twice')}</SelectItem>
                    <SelectItem value="thrice">{t('createTestPlanWizard.step3.reRunOnFailure.options.thrice', 'Thrice')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label>{t('createTestPlanWizard.step3.sendNotificationWhen.label', 'Send Notification When')}</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-1 p-3 border rounded-md">
                  {Object.keys(notificationSettings).map((key) => (
                    <div key={key} className="flex items-center space-x-2">
                      <Checkbox
                        id={`notify-${key}`}
                        checked={notificationSettings[key as keyof typeof notificationSettings]}
                        onCheckedChange={(checked) => {
                          setNotificationSettings(prev => ({ ...prev, [key]: !!checked }));
                        }}
                      />
                      <Label htmlFor={`notify-${key}`} className="font-normal capitalize">
                        {t(`createTestPlanWizard.step3.sendNotificationWhen.options.${key}`, key)}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="step3Description">{t('createTestPlanWizard.step1.descriptionField.label', 'Description')}</Label>
                <Textarea id="step3Description" value={description} disabled rows={2} className="mt-1 bg-muted" />
              </div>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  const resetForm = () => {
    setCurrentStep(1);
    setTestPlanName('');
    setDescription('');
    setTestPlanNameError('');
    setTestMachines([]);
    setCurrentOs('');
    setCurrentOsVersion('');
    setCurrentBrowserName('chrome');
    setCurrentBrowserVersion('latest');
    setCurrentHeadless(false);
    setTestMachineFormError(null);
    setSelectedTestSuites([]);
    setIsTestSuiteSelectorOpen(false);
    setStep2ValidationError('');
    setCaptureScreenshots('on_failed_steps');
    setVisualTestingEnabled(false);
    setPageLoadTimeout("30");
    setElementTimeout("30");
    setOnMajorStepFailure('abort_and_run_next_test_case');
    setOnAbortedTestCase('delete_cookies_and_reuse_session');
    setOnTestSuitePreRequisiteFailure('stop_execution');
    setOnTestCasePreRequisiteFailure('stop_execution');
    setOnTestStepPreRequisiteFailure('abort_and_run_next_test_case');
    setReRunOnFailure('none');
    setNotificationSettings({ passed: true, failed: true, notExecuted: true, stopped: true });
    setPageLoadTimeoutError('');
    setElementTimeoutError('');
    setIsSubmitting(false);
    setSubmitError(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        onClose();
        resetForm();
      }
    }}>
      <DialogContent className="sm:max-w-[600px] md:max-w-[800px] lg:max-w-[900px] max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          {/* Title and Description are now part of renderStepContent */}
        </DialogHeader>
        <div className="flex items-center justify-center my-4 flex-shrink-0">
            {Array.from({ length: totalSteps }, (_, i) => (
              <React.Fragment key={i}>
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center border-2
                    ${i + 1 < currentStep ? 'bg-green-500 border-green-500 text-white' : ''}
                    ${i + 1 === currentStep ? 'border-primary text-primary font-semibold scale-110' : 'border-gray-300'}
                    ${i + 1 > currentStep ? 'border-gray-300 text-gray-400' : ''}
                  `}
                >
                  {i + 1 < currentStep ? '✔' : i + 1}
                </div>
                {i < totalSteps - 1 && (
                  <div className={`flex-auto border-t-2 mx-2
                    ${i + 1 < currentStep ? 'border-green-500' : 'border-gray-300'}`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        <div className="flex-grow overflow-y-auto pr-2 pl-1 scrollbar-thin scrollbar-thumb-muted-foreground/50 scrollbar-track-transparent">
          {renderStepContent()}
        </div>
        <DialogFooter className="mt-6 flex-shrink-0">
          <div className="w-full flex justify-between items-center">
            <Button variant="outline" onClick={() => { onClose(); resetForm(); }} disabled={isSubmitting}>
              {t('createTestPlanWizard.cancel', 'Cancel')}
            </Button>
            <div className="flex items-center space-x-2">
              {currentStep > 1 && (
                <Button variant="outline" onClick={handlePrevious} disabled={isSubmitting}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> {t('createTestPlanWizard.previous', 'Previous')}
                </Button>
              )}
              {currentStep < totalSteps && (
                <Button onClick={handleNext} disabled={isSubmitting}>
                  {t('createTestPlanWizard.next', 'Next')} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
              {currentStep === totalSteps && (
                <Button
                  onClick={handleCreatePlan}
                  className="bg-green-500 hover:bg-green-600"
                  disabled={isSubmitting}
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isSubmitting ? t('createTestPlanWizard.creatingPlan', 'Creating...') : t('createTestPlanWizard.createPlan', 'Create Plan')}
                </Button>
              )}
            </div>
          </div>
          {submitError && <p className="text-sm text-red-500 mt-3 text-right w-full">{submitError}</p>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTestPlanWizard;
