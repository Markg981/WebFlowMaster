import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ArrowLeft, ArrowRight, Info } from 'lucide-react';

interface CreateTestPlanWizardProps {
  onClose: () => void;
  // TODO: Add onSave prop later: onSave: (data: TestPlanFormData) => void;
}

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, PlusCircle, Trash2, ChevronsUpDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

// TODO: Replace with actual data fetching for tests
const fetchAvailableTests = async (): Promise<AvailableTest[]> => {
  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 500));
  return [
    { id: 'test1', name: 'Login Functionality', description: 'Test login with valid and invalid credentials.', type: 'UI Test' },
    { id: 'test2', name: 'User Registration', description: 'Ensure new users can register successfully.', type: 'UI Test' },
    { id: 'test3', name: 'API - Get Users', description: 'Verify /api/users endpoint returns users.', type: 'API Test' },
    { id: 'test4', name: 'Homepage Load Test', description: 'Check homepage loads within performance threshold.', type: 'Performance' },
  ];
};


interface TestPlanStep1Data {
  name: string;
  description: string;
}

interface TestMachineConfig {
  id: string; // For unique key in list
  testMachine: string;
  osVersion: string;
  browser: string;
  browserVersion: string;
  headless: boolean;
}

interface AvailableTest {
  id: string;
  name: string;
  description: string;
  type: string;
}

interface SelectedTestSuite extends AvailableTest {}

interface TestPlanStep2Data {
  testMachines: TestMachineConfig[];
  selectedTestSuites: SelectedTestSuite[];
}

interface TestPlanStep3Data {
  captureScreenshots: 'always' | 'on_failed_steps' | 'never';
  visualTestingEnabled: boolean;
  pageLoadTimeout: string; // Store as string for input, parse to number on save
  elementTimeout: string;  // Store as string for input, parse to number on save
  onMajorStepFailure: 'abort_run_next_case' | 'stop_execution' | 'retry_step';
  onAbortedTestCase: 'delete_cookies_reuse_session' | 'stop_execution';
  onTestSuitePreRequisiteFailure: 'stop_execution' | 'skip_test_suite' | 'continue_anyway';
  onTestCasePreRequisiteFailure: 'stop_execution' | 'skip_test_case' | 'continue_anyway';
  onTestStepPreRequisiteFailure: 'abort_run_next_case' | 'stop_execution' | 'skip_test_step';
  reRunOnFailure: 'none' | 'once' | 'twice' | 'thrice';
  notifications: {
    passed: boolean;
    failed: boolean;
    notExecuted: boolean;
    stopped: boolean;
  };
}

// Combine all step data interfaces later for the final payload
interface TestPlanFormData extends TestPlanStep1Data, TestPlanStep2Data, TestPlanStep3Data {}


const TOTAL_STEPS = 3;

// Mock data - replace with actual data sources or API calls
const MOCK_TEST_MACHINES = ['Sauce Labs Device 1', 'BrowserStack VM 2', 'Local Machine'];
const MOCK_OS_VERSIONS = ['Windows 10', 'Windows 11', 'macOS Sonoma', 'Ubuntu 22.04'];
const MOCK_BROWSERS = ['Chrome', 'Firefox', 'Safari', 'Edge'];

const CreateTestPlanWizard: React.FC<CreateTestPlanWizardProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1 Data
  const [step1Data, setStep1Data] = useState<TestPlanStep1Data>({
    name: '',
    description: '',
  });
  const [step1Errors, setStep1Errors] = useState<{ name?: string }>({});

  // Step 2 Data
  const [step2Data, setStep2Data] = useState<TestPlanStep2Data>({
    testMachines: [],
    selectedTestSuites: [],
  });
  const [currentMachineConfig, setCurrentMachineConfig] = useState<Omit<TestMachineConfig, 'id'>>({
    testMachine: '', osVersion: '', browser: '', browserVersion: '', headless: false,
  });
  const [isAddSuiteModalOpen, setIsAddSuiteModalOpen] = useState(false);
  const [testSearchTerm, setTestSearchTerm] = useState('');
  const [temporarilySelectedSuites, setTemporarilySelectedSuites] = useState<Record<string, boolean>>({});

  // Step 3 Data
  const [step3Data, setStep3Data] = useState<TestPlanStep3Data>({
    captureScreenshots: 'on_failed_steps',
    visualTestingEnabled: false,
    pageLoadTimeout: '30',
    elementTimeout: '30',
    onMajorStepFailure: 'abort_run_next_case',
    onAbortedTestCase: 'delete_cookies_reuse_session',
    onTestSuitePreRequisiteFailure: 'stop_execution',
    onTestCasePreRequisiteFailure: 'stop_execution',
    onTestStepPreRequisiteFailure: 'abort_run_next_case',
    reRunOnFailure: 'none',
    notifications: { passed: true, failed: true, notExecuted: true, stopped: true },
  });
  const [step3Errors, setStep3Errors] = useState<{ pageLoadTimeout?: string; elementTimeout?: string }>({});


  const { data: availableTests = [], isLoading: isLoadingTests } = useQuery<AvailableTest[]>({
    queryKey: ['availableTestsForWizard'],
    queryFn: fetchAvailableTests,
  });


  const validateStep1 = () => {
    const newErrors: { name?: string } = {};
    if (!step1Data.name.trim()) {
      newErrors.name = t('createTestPlanWizard.step1.validation.nameRequired');
    }
    setStep1Errors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep3 = () => {
    const newErrors: { pageLoadTimeout?: string; elementTimeout?: string } = {};
    if (!step3Data.pageLoadTimeout.trim() || isNaN(Number(step3Data.pageLoadTimeout)) || Number(step3Data.pageLoadTimeout) <=0) {
      newErrors.pageLoadTimeout = t('createTestPlanWizard.step3.validation.pageLoadTimeoutRequired');
    }
    if (!step3Data.elementTimeout.trim() || isNaN(Number(step3Data.elementTimeout)) || Number(step3Data.elementTimeout) <=0) {
      newErrors.elementTimeout = t('createTestPlanWizard.step3.validation.elementTimeoutRequired');
    }
    setStep3Errors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  const handleNext = () => {
    if (currentStep === 1 && !validateStep1()) return;
    // if (currentStep === 2 && !validateStep2()) return; // No validation for step 2 for now
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const handleStep1Change = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setStep1Data(prev => ({ ...prev, [name]: value }));
    if (name === 'name' && step1Errors.name) {
      setStep1Errors(prev => ({ ...prev, name: undefined }));
    }
  };

  const handleMachineConfigChange = (field: keyof Omit<TestMachineConfig, 'id' | 'headless'>, value: string) => {
    setCurrentMachineConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleHeadlessToggle = (pressed: boolean) => {
    setCurrentMachineConfig(prev => ({ ...prev, headless: pressed }));
  };

  const handleAddMachineConfig = () => {
    if (!currentMachineConfig.testMachine || !currentMachineConfig.osVersion || !currentMachineConfig.browser) {
      alert(t('createTestPlanWizard.step2.validation.machineConfigRequiredFields'));
      return;
    }
    setStep2Data(prev => ({
      ...prev,
      testMachines: [...prev.testMachines, { ...currentMachineConfig, id: Date.now().toString() }]
    }));
    setCurrentMachineConfig({ testMachine: '', osVersion: '', browser: '', browserVersion: '', headless: false });
  };

  const handleRemoveMachineConfig = (id: string) => {
    setStep2Data(prev => ({ ...prev, testMachines: prev.testMachines.filter(machine => machine.id !== id) }));
  };

  const openAddSuiteModal = () => {
    const initialSelections: Record<string, boolean> = {};
    step2Data.selectedTestSuites.forEach(suite => { initialSelections[suite.id] = true; });
    setTemporarilySelectedSuites(initialSelections);
    setIsAddSuiteModalOpen(true);
  };

  const handleSuiteSelectionToggle = (suiteId: string) => {
    setTemporarilySelectedSuites(prev => ({ ...prev, [suiteId]: !prev[suiteId] }));
  };

  const confirmAddSuites = () => {
    const newlySelectedIds = Object.entries(temporarilySelectedSuites).filter(([,isSelected]) => isSelected).map(([id]) => id);
    const newSuitesToAdd = availableTests.filter(test => newlySelectedIds.includes(test.id));
    const currentSelectedIds = new Set(step2Data.selectedTestSuites.map(s => s.id));
    const uniqueNewSuites = newSuitesToAdd.filter(s => !currentSelectedIds.has(s.id));
    setStep2Data(prev => ({ ...prev, selectedTestSuites: [...prev.selectedTestSuites, ...uniqueNewSuites] }));
    setIsAddSuiteModalOpen(false);
    setTestSearchTerm('');
  };

  const handleRemoveSelectedSuite = (suiteId: string) => {
    setStep2Data(prev => ({ ...prev, selectedTestSuites: prev.selectedTestSuites.filter(suite => suite.id !== suiteId) }));
  };

  const handleStep3InputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    if (name.startsWith("notification_")) {
      const key = name.split("_")[1] as keyof TestPlanStep3Data['notifications'];
      setStep3Data(prev => ({ ...prev, notifications: { ...prev.notifications, [key]: checked }}));
    } else {
      setStep3Data(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    }

    if ((name === 'pageLoadTimeout' && step3Errors.pageLoadTimeout) || (name === 'elementTimeout' && step3Errors.elementTimeout)) {
       setStep3Errors(prev => ({...prev, [name]: undefined }));
    }
  };

  const handleStep3SelectChange = (name: keyof TestPlanStep3Data, value: string) => {
    setStep3Data(prev => ({ ...prev, [name]: value }));
  };

  const handleStep3ToggleChange = (name: keyof TestPlanStep3Data, pressed: boolean) => {
    setStep3Data(prev => ({ ...prev, [name]: pressed }));
  }

  const handleCreatePlan = () => {
    if (!validateStep3()) return;
    // TODO: Assemble the full data object and call onSave
    const fullFormData: TestPlanFormData = {
      ...step1Data,
      ...step2Data,
      ...step3Data,
      // Ensure timeouts are numbers if your backend expects them
      pageLoadTimeout: step3Data.pageLoadTimeout, // Will be parsed on backend or before sending
      elementTimeout: step3Data.elementTimeout,
    };
    console.log("Creating Test Plan with data:", fullFormData);
    // alert(t('createTestPlanWizard.planCreationInitiated')); // Placeholder

    // --- START API Call Logic ---
    // NOTE: queryClient from react-query should be imported if used for cache invalidation
    // import { useQueryClient } from '@tanstack/react-query';
    // const queryClient = useQueryClient();
    // For now, we'll assume a global way to refetch or the parent component handles it.

    fetch('/api/test-plans', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // TODO: Add Authorization header if required by your auth setup
        // 'Authorization': `Bearer ${your_auth_token}`,
      },
      body: JSON.stringify(fullFormData),
    })
    .then(async response => {
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText })); // Try to parse JSON, fallback to statusText
        // TODO: Use a toast notification for better UX
        alert(`${t('createTestPlanWizard.errors.failedToCreate')}: ${errorData.error || response.statusText}`);
        // Do NOT close modal on server error, allow user to retry or correct.
        return;
      }
      // const newPlan = await response.json(); // Contains the created plan from backend
      // TODO: Use a success toast
      alert(t('createTestPlanWizard.success.planCreatedSuccessfully'));

      // onClose will be called, which in TestSuitesPage.tsx will invalidate the query.
      onClose(); // Close modal on success
    })
    .catch(error => {
      console.error("Error creating test plan:", error);
      // TODO: Use a toast notification
      alert(t('createTestPlanWizard.errors.networkError'));
      // Do NOT close modal on network error.
    });
    // --- END API Call Logic ---
  };

import { Dialog, DialogTrigger, DialogContent as ModalContent, DialogHeader as ModalHeader, DialogTitle as ModalTitle, DialogFooter as ModalFooter, DialogClose as ModalClose } from '@/components/ui/dialog'; // Aliasing for clarity
import { Checkbox } from "@/components/ui/checkbox";


  const filteredAvailableTests = availableTests.filter(test =>
    test.name.toLowerCase().includes(testSearchTerm.toLowerCase()) ||
    test.description.toLowerCase().includes(testSearchTerm.toLowerCase())
  );


  const renderStepContent = () => {
    switch (currentStep) {
      case 1: // Unchanged
        return (
          <div className="space-y-6 p-1">
            <h3 className="text-lg font-medium mb-4">{t('createTestPlanWizard.step1.detailsTitle')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="testPlanName">{t('createTestPlanWizard.step1.testPlanNameLabel')}</Label>
                <Input id="testPlanName" name="name" value={step1Data.name} onChange={handleStep1Change} placeholder={t('createTestPlanWizard.step1.testPlanNamePlaceholder')} className={step1Errors.name ? 'border-red-500' : ''} />
                {step1Errors.name && <p className="text-sm text-red-500 mt-1">{step1Errors.name}</p>}
              </div>
              <div>
                <Label htmlFor="description">{t('createTestPlanWizard.step1.descriptionLabel')}</Label>
                <Textarea id="description" name="description" value={step1Data.description} onChange={handleStep1Change} placeholder={t('createTestPlanWizard.step1.descriptionPlaceholder')} rows={3} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              <div>
                <Label htmlFor="testLab">{t('createTestPlanWizard.step1.selectTestLabLabel')}</Label>
                <Input id="testLab" value="Web Test Automator" disabled className="bg-muted/50" />
                <p className="text-xs text-muted-foreground mt-1 flex items-center"><Info size={12} className="mr-1" /> {t('createTestPlanWizard.step1.testLabInfo')}</p>
              </div>
              <div>
                <Label htmlFor="testingType">{t('createTestPlanWizard.step1.testingTypeLabel')}</Label>
                <Input id="testingType" value="Cross Browser Testing" disabled className="bg-muted/50" />
                <p className="text-xs text-muted-foreground mt-1 flex items-center"><Info size={12} className="mr-1" /> {t('createTestPlanWizard.step1.testingTypeInfo')}</p>
              </div>
            </div>
          </div>
        );
      case 2: // Unchanged
        return (
          <div className="space-y-8 p-1">
            <section>
              <h3 className="text-lg font-medium mb-3">{t('createTestPlanWizard.step2.testMachinesConfigTitle')}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-end p-4 border rounded-md">
                <div>
                  <Label htmlFor="testMachine">{t('createTestPlanWizard.step2.testMachineLabel')}</Label>
                  <Select value={currentMachineConfig.testMachine} onValueChange={(val) => handleMachineConfigChange('testMachine', val)}>
                    <SelectTrigger id="testMachine"><SelectValue placeholder={t('createTestPlanWizard.step2.testMachinePlaceholder')} /></SelectTrigger>
                    <SelectContent>{MOCK_TEST_MACHINES.map(machine => <SelectItem key={machine} value={machine}>{machine}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="osVersion">{t('createTestPlanWizard.step2.osVersionLabel')}</Label>
                   <Select value={currentMachineConfig.osVersion} onValueChange={(val) => handleMachineConfigChange('osVersion', val)}>
                    <SelectTrigger id="osVersion"><SelectValue placeholder={t('createTestPlanWizard.step2.osVersionPlaceholder')} /></SelectTrigger>
                    <SelectContent>{MOCK_OS_VERSIONS.map(os => <SelectItem key={os} value={os}>{os}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="browser">{t('createTestPlanWizard.step2.browserLabel')}</Label>
                   <Select value={currentMachineConfig.browser} onValueChange={(val) => handleMachineConfigChange('browser', val)}>
                    <SelectTrigger id="browser"><SelectValue placeholder={t('createTestPlanWizard.step2.browserPlaceholder')} /></SelectTrigger>
                    <SelectContent>{MOCK_BROWSERS.map(browser => <SelectItem key={browser} value={browser}>{browser}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="browserVersion">{t('createTestPlanWizard.step2.browserVersionLabel')}</Label>
                  <Input id="browserVersion" value={currentMachineConfig.browserVersion} onChange={(e) => handleMachineConfigChange('browserVersion', e.target.value)} placeholder={t('createTestPlanWizard.step2.browserVersionPlaceholder')} />
                </div>
                <div className="flex items-center space-x-2">
                  <Toggle id="headless" pressed={currentMachineConfig.headless} onPressedChange={handleHeadlessToggle} aria-label={t('createTestPlanWizard.step2.headlessToggleLabel')}>{t('createTestPlanWizard.step2.headlessLabel')}</Toggle>
                </div>
                <Button onClick={handleAddMachineConfig} size="sm" className="self-end sm:col-start-3 md:col-start-auto"><PlusCircle size={16} className="mr-2" />{t('createTestPlanWizard.step2.addMachineButton')}</Button>
              </div>
               <p className="text-xs text-muted-foreground mt-2 text-center"><a href="#" className="underline hover:text-primary">{t('createTestPlanWizard.step2.desiredCapabilitiesLink')}</a></p>
              {step2Data.testMachines.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="text-sm font-medium">{t('createTestPlanWizard.step2.addedMachinesTitle')}</h4>
                  <ScrollArea className="h-32 rounded-md border p-2">
                    {step2Data.testMachines.map((machine) => (
                      <div key={machine.id} className="flex justify-between items-center p-2 hover:bg-muted/50 rounded-md text-sm">
                        <span>{machine.testMachine} - {machine.osVersion} - {machine.browser} {machine.browserVersion} ({machine.headless ? 'Headless' : 'UI'})</span>
                        <Button variant="ghost" size="icon" onClick={() => handleRemoveMachineConfig(machine.id)} className="h-6 w-6"><Trash2 size={14} /></Button>
                      </div>))}
                  </ScrollArea>
                </div>)}
            </section>
            <section>
              <h3 className="text-lg font-medium mb-3">{t('createTestPlanWizard.step2.testSuitesSelectionTitle')}</h3>
              <div className="border rounded-md p-4">
                <div className="flex justify-end mb-3">
                  <Dialog open={isAddSuiteModalOpen} onOpenChange={setIsAddSuiteModalOpen}>
                    <DialogTrigger asChild><Button variant="outline" size="sm" onClick={openAddSuiteModal}><PlusCircle size={16} className="mr-2" />{t('createTestPlanWizard.step2.addTestSuitesButton')}</Button></DialogTrigger>
                    <ModalContent className="sm:max-w-2xl">
                      <ModalHeader><ModalTitle>{t('createTestPlanWizard.step2.addSuitesModal.title')}</ModalTitle></ModalHeader>
                      <div className="py-4 space-y-4">
                        <Input type="search" placeholder={t('createTestPlanWizard.step2.addSuitesModal.searchPlaceholder')} value={testSearchTerm} onChange={(e) => setTestSearchTerm(e.target.value)} />
                        {isLoadingTests ? (<p>{t('createTestPlanWizard.step2.addSuitesModal.loadingTests')}</p>)
                         : filteredAvailableTests.length === 0 ? (<p>{t('createTestPlanWizard.step2.addSuitesModal.noTestsFound')}</p>)
                         : (<ScrollArea className="h-64 border rounded-md p-2">
                            {filteredAvailableTests.map(test => (
                              <div key={test.id} className="flex items-center space-x-3 p-2 hover:bg-muted/50 rounded-md">
                                <Checkbox id={`suite-${test.id}`} checked={!!temporarilySelectedSuites[test.id]} onCheckedChange={() => handleSuiteSelectionToggle(test.id)} />
                                <Label htmlFor={`suite-${test.id}`} className="flex-1 cursor-pointer">
                                  <p className="font-medium">{test.name} <span className="text-xs text-muted-foreground">({test.type})</span></p>
                                  <p className="text-xs text-muted-foreground">{test.description}</p>
                                </Label>
                              </div>))}
                          </ScrollArea>)}
                      </div>
                      <ModalFooter>
                        <ModalClose asChild><Button variant="outline">{t('createTestPlanWizard.step2.addSuitesModal.cancelButton')}</Button></ModalClose>
                        <Button onClick={confirmAddSuites}>{t('createTestPlanWizard.step2.addSuitesModal.addButton')}</Button>
                      </ModalFooter>
                    </ModalContent>
                  </Dialog>
                </div>
                {step2Data.selectedTestSuites.length === 0 ? (<p className="text-sm text-muted-foreground text-center py-4">{t('createTestPlanWizard.step2.noTestSuitesSelected')}</p>)
                 : (<ScrollArea className="h-40 rounded-md border p-2">
                    {step2Data.selectedTestSuites.map(suite => (
                      <div key={suite.id} className="flex justify-between items-center p-2 hover:bg-muted/50 rounded-md text-sm">
                        <div>
                          <p className="font-medium">{suite.name} <span className="text-xs text-muted-foreground">({suite.type})</span></p>
                          <p className="text-xs text-muted-foreground truncate max-w-md">{suite.description}</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => handleRemoveSelectedSuite(suite.id)} className="h-6 w-6"><X size={14} /></Button>
                      </div>))}
                  </ScrollArea>)}
              </div>
            </section>
          </div>
        );
      case 3:
        return (
          <div className="space-y-6 p-1">
            <h3 className="text-lg font-medium mb-4">{t('createTestPlanWizard.step3.settingsTitle')}</h3>

            {/* Row 1: Screenshots, Visual Testing, Timeouts */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
              <div>
                <Label htmlFor="captureScreenshots">{t('createTestPlanWizard.step3.captureScreenshotsLabel')}</Label>
                <Select name="captureScreenshots" value={step3Data.captureScreenshots} onValueChange={(value) => handleStep3SelectChange('captureScreenshots', value as TestPlanStep3Data['captureScreenshots'])}>
                  <SelectTrigger id="captureScreenshots"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">{t('createTestPlanWizard.step3.screenshotOptions.always')}</SelectItem>
                    <SelectItem value="on_failed_steps">{t('createTestPlanWizard.step3.screenshotOptions.onFailedSteps')}</SelectItem>
                    <SelectItem value="never">{t('createTestPlanWizard.step3.screenshotOptions.never')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col pt-2"> {/* Align toggle with label better */}
                <Label htmlFor="visualTestingEnabled" className="mb-2">{t('createTestPlanWizard.step3.visualTestingLabel')}</Label>
                <Toggle id="visualTestingEnabled" pressed={step3Data.visualTestingEnabled} onPressedChange={(pressed) => handleStep3ToggleChange('visualTestingEnabled', pressed)} aria-label={t('createTestPlanWizard.step3.visualTestingLabel')}>
                  {step3Data.visualTestingEnabled ? t('createTestPlanWizard.enabled') : t('createTestPlanWizard.disabled')}
                </Toggle>
              </div>
              <div>
                <Label htmlFor="pageLoadTimeout">{t('createTestPlanWizard.step3.pageLoadTimeoutLabel')}</Label>
                <Input type="number" id="pageLoadTimeout" name="pageLoadTimeout" value={step3Data.pageLoadTimeout} onChange={handleStep3InputChange} placeholder="30" className={step3Errors.pageLoadTimeout ? 'border-red-500' : ''} />
                {step3Errors.pageLoadTimeout && <p className="text-sm text-red-500 mt-1">{step3Errors.pageLoadTimeout}</p>}
              </div>
              <div>
                <Label htmlFor="elementTimeout">{t('createTestPlanWizard.step3.elementTimeoutLabel')}</Label>
                <Input type="number" id="elementTimeout" name="elementTimeout" value={step3Data.elementTimeout} onChange={handleStep3InputChange} placeholder="30" className={step3Errors.elementTimeout ? 'border-red-500' : ''}/>
                {step3Errors.elementTimeout && <p className="text-sm text-red-500 mt-1">{step3Errors.elementTimeout}</p>}
              </div>
            </div>

            {/* Row 2: Failure Handling */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
              <div>
                <Label htmlFor="onMajorStepFailure">{t('createTestPlanWizard.step3.onMajorStepFailureLabel')}</Label>
                <Select name="onMajorStepFailure" value={step3Data.onMajorStepFailure} onValueChange={(value) => handleStep3SelectChange('onMajorStepFailure', value as TestPlanStep3Data['onMajorStepFailure'])}>
                  <SelectTrigger id="onMajorStepFailure"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="abort_run_next_case">{t('createTestPlanWizard.step3.failureOptions.majorStep.abortRunNextCase')}</SelectItem>
                    <SelectItem value="stop_execution">{t('createTestPlanWizard.step3.failureOptions.stopExecution')}</SelectItem>
                    <SelectItem value="retry_step">{t('createTestPlanWizard.step3.failureOptions.majorStep.retryStep')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="onAbortedTestCase">{t('createTestPlanWizard.step3.onAbortedTestCaseLabel')}</Label>
                 <Select name="onAbortedTestCase" value={step3Data.onAbortedTestCase} onValueChange={(value) => handleStep3SelectChange('onAbortedTestCase', value as TestPlanStep3Data['onAbortedTestCase'])}>
                  <SelectTrigger id="onAbortedTestCase"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delete_cookies_reuse_session">{t('createTestPlanWizard.step3.failureOptions.abortedCase.deleteCookiesReuseSession')}</SelectItem>
                    <SelectItem value="stop_execution">{t('createTestPlanWizard.step3.failureOptions.stopExecution')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
               <div>
                <Label htmlFor="reRunOnFailure">{t('createTestPlanWizard.step3.reRunOnFailureLabel')}</Label>
                <Select name="reRunOnFailure" value={step3Data.reRunOnFailure} onValueChange={(value) => handleStep3SelectChange('reRunOnFailure', value as TestPlanStep3Data['reRunOnFailure'])}>
                  <SelectTrigger id="reRunOnFailure"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('createTestPlanWizard.step3.reRunOptions.none')}</SelectItem>
                    <SelectItem value="once">{t('createTestPlanWizard.step3.reRunOptions.once')}</SelectItem>
                    <SelectItem value="twice">{t('createTestPlanWizard.step3.reRunOptions.twice')}</SelectItem>
                    <SelectItem value="thrice">{t('createTestPlanWizard.step3.reRunOptions.thrice')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 3: Pre-Requisite Failure Handling */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
              <div>
                <Label htmlFor="onTestSuitePreRequisiteFailure">{t('createTestPlanWizard.step3.onTestSuitePreRequisiteFailureLabel')}</Label>
                <Select name="onTestSuitePreRequisiteFailure" value={step3Data.onTestSuitePreRequisiteFailure} onValueChange={(value) => handleStep3SelectChange('onTestSuitePreRequisiteFailure', value as TestPlanStep3Data['onTestSuitePreRequisiteFailure'])}>
                  <SelectTrigger id="onTestSuitePreRequisiteFailure"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stop_execution">{t('createTestPlanWizard.step3.failureOptions.stopExecution')}</SelectItem>
                    <SelectItem value="skip_test_suite">{t('createTestPlanWizard.step3.failureOptions.preRequisite.skipTestSuite')}</SelectItem>
                    <SelectItem value="continue_anyway">{t('createTestPlanWizard.step3.failureOptions.preRequisite.continueAnyway')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="onTestCasePreRequisiteFailure">{t('createTestPlanWizard.step3.onTestCasePreRequisiteFailureLabel')}</Label>
                <Select name="onTestCasePreRequisiteFailure" value={step3Data.onTestCasePreRequisiteFailure} onValueChange={(value) => handleStep3SelectChange('onTestCasePreRequisiteFailure', value as TestPlanStep3Data['onTestCasePreRequisiteFailure'])}>
                  <SelectTrigger id="onTestCasePreRequisiteFailure"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stop_execution">{t('createTestPlanWizard.step3.failureOptions.stopExecution')}</SelectItem>
                    <SelectItem value="skip_test_case">{t('createTestPlanWizard.step3.failureOptions.preRequisite.skipTestCase')}</SelectItem>
                    <SelectItem value="continue_anyway">{t('createTestPlanWizard.step3.failureOptions.preRequisite.continueAnyway')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="onTestStepPreRequisiteFailure">{t('createTestPlanWizard.step3.onTestStepPreRequisiteFailureLabel')}</Label>
                <Select name="onTestStepPreRequisiteFailure" value={step3Data.onTestStepPreRequisiteFailure} onValueChange={(value) => handleStep3SelectChange('onTestStepPreRequisiteFailure', value as TestPlanStep3Data['onTestStepPreRequisiteFailure'])}>
                  <SelectTrigger id="onTestStepPreRequisiteFailure"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="abort_run_next_case">{t('createTestPlanWizard.step3.failureOptions.majorStep.abortRunNextCase')}</SelectItem>
                    <SelectItem value="stop_execution">{t('createTestPlanWizard.step3.failureOptions.stopExecution')}</SelectItem>
                    <SelectItem value="skip_test_step">{t('createTestPlanWizard.step3.failureOptions.preRequisite.skipTestStep')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 4: Notifications & Display Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 items-start">
              <div>
                <Label className="mb-2 block">{t('createTestPlanWizard.step3.sendNotificationWhenLabel')}</Label>
                <div className="space-y-2">
                  {(Object.keys(step3Data.notifications) as Array<keyof TestPlanStep3Data['notifications']>).map((key) => (
                    <div key={key} className="flex items-center space-x-2">
                      <Checkbox
                        id={`notification_${key}`}
                        name={`notification_${key}`}
                        checked={step3Data.notifications[key]}
                        onCheckedChange={(checked) => {
                           const newNotifications = { ...step3Data.notifications, [key]: !!checked };
                           setStep3Data(prev => ({ ...prev, notifications: newNotifications }));
                        }}
                      />
                      <Label htmlFor={`notification_${key}`} className="font-normal">
                        {t(`createTestPlanWizard.step3.notificationOptions.${key}`)}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <Label>{t('createTestPlanWizard.step3.testingTypeDisplayLabel')}</Label>
                  <Input value="Cross Browser Testing" disabled className="bg-muted/50" />
                </div>
                <div>
                  <Label>{t('createTestPlanWizard.step3.descriptionDisplayLabel')}</Label>
                  <Textarea value={step1Data.description || t('createTestPlanWizard.step3.noDescriptionProvided')} disabled className="bg-muted/50" rows={3} />
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <DialogContent className="p-0 overflow-hidden">
      <DialogHeader className="px-6 py-4 border-b">
        <DialogTitle>
          {t('createTestPlanWizard.title')} - {t('createTestPlanWizard.step')} {currentStep} {t('createTestPlanWizard.of')} {TOTAL_STEPS}
        </DialogTitle>
        <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700 my-3">
          <div
            className="bg-primary h-2 rounded-full transition-all duration-300 ease-in-out"
            style={{ width: `${(currentStep / TOTAL_STEPS) * 100}%` }}
          ></div>
        </div>
      </DialogHeader>

      <div className="px-6 py-2 max-h-[calc(90vh-200px)] overflow-y-auto custom-scrollbar">
        {renderStepContent()}
      </div>

      <DialogFooter className="justify-between px-6 py-4 border-t">
        <div>
          {currentStep > 1 && (
            <Button variant="outline" onClick={handlePrevious}>
              <ArrowLeft className="mr-2 h-4 w-4" /> {t('createTestPlanWizard.previousButton')}
            </Button>
          )}
        </div>
        <div className="flex space-x-2">
          <DialogClose asChild>
            <Button variant="ghost" onClick={onClose}>
              {t('createTestPlanWizard.cancelButton')}
            </Button>
          </DialogClose>
          {currentStep < TOTAL_STEPS && (
            <Button onClick={handleNext}>
              {t('createTestPlanWizard.nextButton')} <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
          {currentStep === TOTAL_STEPS && (
            <Button onClick={handleCreatePlan}>
              {t('createTestPlanWizard.createPlanButton')}
            </Button>
          )}
        </div>
      </DialogFooter>
    </DialogContent>
  );
};

export default CreateTestPlanWizard;
