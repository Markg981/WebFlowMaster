import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X } from 'lucide-react';
import {
  ElementVariantNameSchema,
  MAX_ELEMENT_VARIANTS,
  type ElementVariants,
} from '@shared/element-variants';

/**
 * The locator variants of one repository element: where the element is in a build that renders
 * it differently. A run whose environment sets `uiVariant` to one of these names uses that
 * locator; every other run keeps the element's own. Each change saves the whole map.
 */
export interface ElementVariantsEditorProps {
  elementName: string;
  variants: ElementVariants;
  saving: boolean;
  onSave: (variants: ElementVariants) => void;
}

const ElementVariantsEditor: React.FC<ElementVariantsEditorProps> = ({
  elementName,
  variants,
  saving,
  onSave,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [selector, setSelector] = useState('');
  const [error, setError] = useState<string | null>(null);
  const entries = Object.entries(variants ?? {});

  const add = () => {
    const trimmed = name.trim();
    if (!ElementVariantNameSchema.safeParse(trimmed).success) {
      setError(
        t(
          'settings.elements.variants.badName',
          'A variant name is letters, digits, "_", "-" or ".", up to 40 characters.',
        ),
      );
      return;
    }
    if (selector.trim() === '') {
      setError(t('settings.elements.variants.noSelector', 'A variant needs a selector.'));
      return;
    }
    setError(null);
    onSave({ ...variants, [trimmed]: { selector: selector.trim() } });
    setName('');
    setSelector('');
  };

  const remove = (variant: string) => {
    const next = { ...variants };
    delete next[variant];
    onSave(next);
  };

  return (
    <div className="mt-2 space-y-1" data-testid={`element-variants-${elementName}`}>
      {entries.map(([variant, locator]) => (
        <div key={variant} className="flex items-center gap-1 text-xs">
          <span className="font-medium whitespace-nowrap">{variant}:</span>
          <code className="break-all">{locator.selector}</code>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            disabled={saving}
            onClick={() => remove(variant)}
            aria-label={t('settings.elements.variants.remove', 'Remove variant {{variant}}', {
              variant,
            })}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      {entries.length < MAX_ELEMENT_VARIANTS && (
        <div className="flex items-center gap-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('settings.elements.variants.name', 'Variant (uiVariant)')}
            className="h-7 w-32 text-xs"
            aria-label={t('settings.elements.variants.nameFor', 'Variant name for {{name}}', {
              name: elementName,
            })}
          />
          <Input
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            placeholder={t('settings.elements.variants.selector', 'Selector in that variant')}
            className="h-7 font-mono text-xs"
            aria-label={t(
              'settings.elements.variants.selectorFor',
              'Variant selector for {{name}}',
              {
                name: elementName,
              },
            )}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            disabled={saving || name.trim() === ''}
            onClick={add}
            aria-label={t('settings.elements.variants.add', 'Add variant')}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
};

export default ElementVariantsEditor;
