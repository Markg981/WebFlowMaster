import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, Loader2, Plus, Tag as TagIcon } from 'lucide-react';

/**
 * What a test is for, chosen from what this organization already says.
 *
 * Picking from a list first, typing second. A tag that can only be typed is a tag that gets
 * typed differently every time — "smoke", "Smoke", "smoke-test" — and three spellings of one
 * idea are worse than no tags at all, because a filter on any of them silently omits the rest.
 * Creating one is still here, because the first person to need a word has to be able to add it.
 */

export interface TagRef {
  id: string;
  name: string;
}

interface TagPickerProps {
  /** The tags this test carries now. */
  selected: TagRef[];
  /** Everything the organization has, so a name is picked rather than retyped. */
  available: TagRef[];
  /** Applies the whole set: the picker says what the test should carry, not what changed. */
  onChange: (tagIds: string[]) => Promise<void> | void;
  /** Adds a word nobody has used yet, and returns it so it can be applied immediately. */
  onCreate: (name: string) => Promise<TagRef>;
  disabled?: boolean;
}

const TagPicker: React.FC<TagPickerProps> = ({ selected, available, onChange, onCreate, disabled }) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  const selectedIds = new Set(selected.map((tag) => tag.id));

  const apply = async (tagIds: string[]) => {
    setError('');
    setIsBusy(true);
    try {
      await onChange(tagIds);
    } catch (applyError: any) {
      setError(applyError?.message ?? 'Could not change the tags');
    } finally {
      setIsBusy(false);
    }
  };

  const toggle = (tag: TagRef) => {
    const next = selectedIds.has(tag.id)
      ? selected.filter((item) => item.id !== tag.id).map((item) => item.id)
      : [...selected.map((item) => item.id), tag.id];
    return apply(next);
  };

  const create = async () => {
    const name = draft.trim();
    if (name === '') return;
    setError('');
    setIsBusy(true);
    try {
      // The server answers with the existing tag when the name is taken, so typing a word
      // somebody else already added applies theirs instead of making a twin.
      const tag = await onCreate(name);
      setDraft('');
      if (!selectedIds.has(tag.id)) await onChange([...selected.map((item) => item.id), tag.id]);
    } catch (createError: any) {
      setError(createError?.message ?? 'Could not create the tag');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {selected.map((tag) => (
        <Badge key={tag.id} variant="secondary" className="font-normal">
          {tag.name}
        </Badge>
      ))}

      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            disabled={disabled}
            aria-label={t('tags.edit', 'Edit tags')}
          >
            <TagIcon className="h-3 w-3 mr-1" />
            {selected.length === 0 ? t('tags.add', 'Add tags') : t('tags.edit', 'Edit tags')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64" align="start">
          <div className="space-y-2">
            <div className="flex gap-1">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void create();
                  }
                }}
                placeholder={t('tags.newPlaceholder', 'New tag')}
                aria-label={t('tags.newPlaceholder', 'New tag')}
                className="h-8"
              />
              <Button size="sm" variant="outline" onClick={create} disabled={isBusy || draft.trim() === ''}>
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="max-h-48 overflow-y-auto">
              {available.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  {t('tags.none', 'No tags yet. The first word you type becomes one.')}
                </p>
              ) : (
                available.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => void toggle(tag)}
                    disabled={isBusy}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-sm hover:bg-muted"
                  >
                    <span>{tag.name}</span>
                    {selectedIds.has(tag.id) && <Check className="h-4 w-4" />}
                  </button>
                ))
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default TagPicker;
