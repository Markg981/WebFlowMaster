import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';

/**
 * The code editor, served by this installation rather than fetched from a CDN.
 *
 * @monaco-editor/react downloads Monaco from cdn.jsdelivr.net at runtime unless told otherwise, so
 * the API tester ran third-party script in every user's session, and did not work at all on a
 * network without internet access. The Content Security Policy (server/security-headers.ts) now
 * refuses scripts from anywhere but here, so the editor and its workers are bundled with the
 * client instead.
 *
 * The workers are the language services the editor uses: JSON and HTML have their own; XML,
 * GraphQL and plain text only need the base one.
 */
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });
