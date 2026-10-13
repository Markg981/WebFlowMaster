import { loader } from '@monaco-editor/react';
// The editor and its standard features (find, folding, context menu), without the language
// bundle: 'monaco-editor' itself brings every language Monaco ships and the TypeScript service,
// about 3 MB the API tester never used.
import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
// The languages the API tester shows: JSON and HTML with their language services (validation,
// folding), XML, GraphQL, CSS and JavaScript highlighted only.
import 'monaco-editor/languages/features/json/register';
import 'monaco-editor/languages/features/html/register';
import 'monaco-editor/languages/definitions/xml/register';
import 'monaco-editor/languages/definitions/graphql/register';
import 'monaco-editor/languages/definitions/css/register';
import 'monaco-editor/languages/definitions/javascript/register';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/languages/features/json/json.worker?worker';
import htmlWorker from 'monaco-editor/languages/features/html/html.worker?worker';

/**
 * The code editor, served by this installation rather than fetched from a CDN.
 *
 * @monaco-editor/react downloads Monaco from cdn.jsdelivr.net at runtime unless told otherwise, so
 * the API tester ran third-party script in every user's session, and did not work at all on a
 * network without internet access. The Content Security Policy (server/platform/security-headers.ts) now
 * refuses scripts from anywhere but here, so the editor and its workers are bundled with the
 * client instead. CodeEditor (components/CodeEditor.tsx) loads this module on first use.
 *
 * The workers are the language services the editor uses: JSON and HTML have their own; XML,
 * GraphQL, CSS, JavaScript and plain text only need the base one.
 */
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });
