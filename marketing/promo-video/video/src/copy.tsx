import { createContext, useContext } from 'react';

export type Language = 'en' | 'it';
export const LanguageContext = createContext<Language>('en');

/**
 * The editorial overlays in Italian. The product's own screens are filmed in each edition's
 * language (demo/capture.mjs); the spoken lines are in narration.json.
 */
export const italian: Record<string, string> = {
  'Every release.': 'Ogni rilascio.',
  'Every browser.': 'Ogni browser.',
  'Every click, by hand?': 'Ogni clic, a mano?',
  'End-to-end testing your whole team can run.': 'Test end-to-end per tutto il team.',
  Build: 'Crea',
  'Record it, or describe it.': 'Registralo, o descrivilo.',
  'Click through your site and every action becomes a step. Or write the steps in plain words.':
    'Clicca sul sito e ogni azione diventa un passo. Oppure scrivi i passi a parole.',
  'Run it. Watch it pass.': 'Eseguilo. Guardalo passare.',
  'No code to maintain.': 'Nessun codice da mantenere.',
  'Beyond the browser': 'Oltre il browser',
  'Gherkin scenarios. Native apps.': 'Scenari Gherkin. App native.',
  'Run BDD features, and test Android and iOS apps with Appium: inspector, recorder, device matrices.':
    'Esegui feature BDD e testa app Android e iOS con Appium: inspector, registratore, matrici di dispositivi.',
  'APIs too': 'Anche le API',
  'Assert, capture, chain.': 'Verifica. Cattura. Collega.',
  'Test the services behind the screens, and pass values from one request to the next.':
    'Testa i servizi dietro le schermate e passa i valori da una richiesta alla successiva.',
  Run: 'Esegui',
  'Every browser. In parallel.': 'Ogni browser. In parallelo.',
  'Chromium, Firefox and WebKit. Dedicated runners for web, mobile and BDD.':
    'Chromium, Firefox e WebKit. Runner dedicati per web, mobile e BDD.',
  Understand: 'Comprendi',
  'Know exactly why it failed.': 'Scopri perché è fallito.',
  'The failing step, its screenshot, the video, the Playwright trace and the network log — one click away.':
    'Il passo fallito, screenshot, video, traccia Playwright e log di rete: tutto a un clic.',
  Measure: 'Misura',
  'Quality, at a glance.': 'La qualità, a colpo d’occhio.',
  'Success rate, trends, what runs next and what just failed — for the whole team.':
    'Successi, trend, prossime esecuzioni e ultimi errori. Una visione condivisa per il team.',
  Connect: 'Integra',
  'Fits the way your team ships.': 'Al passo con il tuo team.',
  'CI/CD, CLI & REST API': 'CI/CD, CLI e REST API',
  'GitHub & GitLab checks': 'Check GitHub e GitLab',
  'Jira & Azure DevOps issues': 'Issue Jira e Azure DevOps',
  'Webhook notifications': 'Notifiche webhook',
  'Agents for private networks': 'Agenti su reti private',
  'SSO, MFA & audit log': 'SSO, MFA e audit log',
  'Ship every release with confidence.': 'Ogni rilascio, con fiducia.',
};

export const useCopy = () => {
  const lang = useContext(LanguageContext);
  return (text: string) => (lang === 'it' ? (italian[text] ?? text) : text);
};
