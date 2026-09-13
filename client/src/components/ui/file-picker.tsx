import * as React from 'react';
import { Paperclip, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * A file field that looks like the rest of the form.
 *
 * `<input type="file">` renders the operating system's own widget — a grey "Choose File /
 * No file chosen" box that ignores every token in the design system and changes shape
 * between browsers. Next to a styled button it is the single clearest sign that a screen was
 * never finished, so the native input stays in the DOM (it is what the browser opens the
 * picker with, and what assistive technology announces) and is visually replaced.
 */
export interface FilePickerProps {
  accept?: string;
  disabled?: boolean;
  /** The file currently chosen, so the control can show its name. */
  file?: File | null;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClear?: () => void;
  className?: string;
  id?: string;
}

export function FilePicker({
  accept,
  disabled,
  file,
  onChange,
  onClear,
  className,
  id,
}: FilePickerProps) {
  const { t } = useTranslation();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const generatedId = React.useId();
  const inputId = id ?? generatedId;

  return (
    <div
      className={cn(
        'flex h-10 items-center gap-2 rounded-md border border-input bg-background pl-3 pr-1 text-sm',
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <label
        htmlFor={inputId}
        className={cn(
          'min-w-0 flex-1 cursor-pointer truncate',
          !file && 'text-muted-foreground',
          disabled && 'cursor-not-allowed',
        )}
      >
        {file ? file.name : t('filePicker.empty', 'No file chosen')}
      </label>

      {file && onClear ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          disabled={disabled}
          onClick={() => {
            if (inputRef.current) inputRef.current.value = '';
            onClear();
          }}
          aria-label={t('filePicker.clear', 'Remove the chosen file')}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-8 shrink-0"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {t('filePicker.browse', 'Browse')}
      </Button>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
    </div>
  );
}
