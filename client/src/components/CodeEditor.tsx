import { lazy, Suspense } from 'react';
import type { EditorProps } from '@monaco-editor/react';

/**
 * The Monaco editor, loaded the first time one is shown.
 *
 * Imported directly, Monaco and its setup were part of the API tester's own chunk, so the page
 * waited for the whole editor before it could render anything. Here the page renders at once and
 * each editor shows an empty box of its own height until Monaco has arrived (cached afterwards).
 */
const MonacoEditor = lazy(async () => {
  await import('@/lib/monaco-setup');
  return import('@monaco-editor/react');
});

export function CodeEditor(props: EditorProps) {
  return (
    <Suspense fallback={<div style={{ height: props.height }} className="bg-muted/30" aria-busy="true" />}>
      <MonacoEditor {...props} />
    </Suspense>
  );
}
