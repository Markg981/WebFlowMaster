import React from 'react';
import { Assertion, AssertionSourceSchema, AssertionComparisonSchema } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, XCircle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface AssertionEditorProps {
  assertions: Assertion[];
  onChange: (assertions: Assertion[]) => void;
  isExecuting?: boolean;
}

const sourceOptions = AssertionSourceSchema.options;
const comparisonOptions = AssertionComparisonSchema.options;

// Define which comparisons are valid for which sources (simplified)
const validComparisonsBySource: Record<Assertion['source'], Array<Assertion['comparison']>> = {
  status_code: ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_than_or_equals', 'less_than_or_equals'],
  header: ['equals', 'not_equals', 'contains', 'not_contains', 'exists', 'not_exists', 'is_empty', 'is_not_empty'],
  body_json_path: [
    'equals', 'not_equals', 'contains', 'not_contains', 'exists', 'not_exists',
    'is_empty', 'is_not_empty', 'greater_than', 'less_than', 'greater_than_or_equals', 'less_than_or_equals'
  ],
  body_text: ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty', 'matches_regex', 'not_matches_regex'],
  response_time: ['greater_than', 'less_than', 'greater_than_or_equals', 'less_than_or_equals'],
};

// Define if 'property' field is needed for a source
const propertyRequiredBySource: Record<Assertion['source'], boolean> = {
  status_code: false,
  header: true,
  body_json_path: true,
  body_text: false,
  response_time: false,
};

// Define if 'targetValue' field is generally needed (some comparisons like exists/is_empty don't need it)
const targetValueRequiredByComparison: Record<Assertion['comparison'], boolean> = {
    equals: true, not_equals: true,
    contains: true, not_contains: true,
    exists: false, not_exists: false,
    is_empty: false, is_not_empty: false,
    greater_than: true, less_than: true,
    greater_than_or_equals: true, less_than_or_equals: true,
    matches_regex: true, not_matches_regex: true,
};


export const AssertionEditor: React.FC<AssertionEditorProps> = ({ assertions, onChange, isExecuting }) => {
  const handleAddAssertion = () => {
    const newAssertion: Assertion = {
      id: uuidv4(),
      source: 'status_code',
      property: '',
      comparison: 'equals',
      targetValue: '200',
      enabled: true,
    };
    onChange([...assertions, newAssertion]);
  };

  const handleRemoveAssertion = (id: string) => {
    onChange(assertions.filter(a => a.id !== id));
  };

  const handleChangeAssertion = (id: string, field: keyof Assertion, value: any) => {
    onChange(
      assertions.map(a => (a.id === id ? { ...a, [field]: value } : a))
    );
  };

  return (
    <div className="space-y-3">
      {assertions.map((assertion) => {
        const availableComparisons = validComparisonsBySource[assertion.source] || comparisonOptions;
        const needsProperty = propertyRequiredBySource[assertion.source];
        const needsTargetValue = targetValueRequiredByComparison[assertion.comparison];

        return (
          <div key={assertion.id} className="p-3 border rounded-md bg-card space-y-2">
            <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">{t('apiTester.assertionEditor.assertion.label')}{assertions.indexOf(assertion)+1}</Label>
                <div className="flex items-center space-x-2">
                    <Label htmlFor={`enabled-${assertion.id}`} className="text-xs">{t('apiTester.assertionEditor.enabled.label')}</Label>
                    <Checkbox
                        id={`enabled-${assertion.id}`}
                        checked={assertion.enabled}
                        onCheckedChange={(checked) => handleChangeAssertion(assertion.id, 'enabled', !!checked)}
                        disabled={isExecuting}
                    />
                    <Button variant="ghost" size="icon" onClick={() => handleRemoveAssertion(assertion.id)} disabled={isExecuting}>
                        <XCircle className="h-4 w-4 text-destructive" />
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <Label htmlFor={`source-${assertion.id}`} className="text-xs">{t('apiTester.assertionEditor.source.label')}</Label>
                <Select
                  value={assertion.source}
                  onValueChange={(value: Assertion['source']) => {
                    const newComparisons = validComparisonsBySource[value] || [];
                    const updatedAssertion = {
                        ...assertion,
                        source: value,
                        property: propertyRequiredBySource[value] ? assertion.property : '', // Clear property if not needed
                        comparison: newComparisons.includes(assertion.comparison) ? assertion.comparison : newComparisons[0] || 'equals' // Reset comparison
                    };
                    onChange(assertions.map(a => (a.id === assertion.id ? updatedAssertion : a)));
                  }}
                  disabled={isExecuting}
                >
                  <SelectTrigger id={`source-${assertion.id}`}>
                    <SelectValue placeholder={t('apiTester.assertionEditor.selectSource.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceOptions.map(option => (
                      <SelectItem key={option} value={option}>{option.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor={`comparison-${assertion.id}`} className="text-xs">{t('apiTester.assertionEditor.comparison.label')}</Label>
                <Select
                  value={assertion.comparison}
                  onValueChange={(value: Assertion['comparison']) => handleChangeAssertion(assertion.id, 'comparison', value)}
                  disabled={isExecuting}
                >
                  <SelectTrigger id={`comparison-${assertion.id}`}>
                    <SelectValue placeholder={t('apiTester.assertionEditor.selectComparison.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableComparisons.map(option => (
                      <SelectItem key={option} value={option}>{option.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {needsProperty && (
              <div>
                <Label htmlFor={`property-${assertion.id}`} className="text-xs">
                  {assertion.source === 'header' ? t('apiTester.assertionEditor.headerName.label') :
                   assertion.source === 'body_json_path' ? t('apiTester.assertionEditor.jsonPathEgDataid.label') :
                   t('apiTester.assertionEditor.property.label')}
                </Label>
                <Input
                  id={`property-${assertion.id}`}
                  value={assertion.property}
                  onChange={(e) => handleChangeAssertion(assertion.id, 'property', e.target.value)}
                  placeholder={
                    assertion.source === 'header' ? t('apiTester.assertionEditor.egContentType.placeholder') :
                    assertion.source === 'body_json_path' ? t('apiTester.assertionEditor.egUsernameOrItems0id.placeholder') : ''
                  }
                  disabled={isExecuting}
                  className="text-sm"
                />
              </div>
            )}

            {needsTargetValue && (
              <div>
                <Label htmlFor={`target-${assertion.id}`} className="text-xs">{t('apiTester.assertionEditor.targetValue.label')}</Label>
                <Input
                  id={`target-${assertion.id}`}
                  value={assertion.targetValue}
                  onChange={(e) => handleChangeAssertion(assertion.id, 'targetValue', e.target.value)}
                  placeholder={
                    assertion.comparison.includes('regex') ? t('apiTester.assertionEditor.enterRegex.placeholder') :
                    assertion.source === 'status_code' ? t('apiTester.assertionEditor.eg200.placeholder') :
                    assertion.source === 'response_time' ? t('apiTester.assertionEditor.eg500InMs.placeholder') :
                    t('apiTester.assertionEditor.expectedValue.placeholder')
                  }
                  disabled={isExecuting}
                  className="text-sm"
                />
              </div>
            )}
          </div>
        );
      })}
      <Button variant="outline" size="sm" onClick={handleAddAssertion} disabled={isExecuting}>
        <PlusCircle className="mr-2 h-4 w-4" /> {t('apiTester.assertionEditor.addAssertion.button')}
      </Button>
    </div>
  );
};
