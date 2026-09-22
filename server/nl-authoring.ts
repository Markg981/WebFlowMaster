import { v4 as uuidv4 } from 'uuid';
import {
  ACTION_I18N,
  ACTION_REQUIREMENTS,
  ACTION_VALUE_OPTIONS,
  ADHOC_ACTION_IDS,
  type AdhocActionId,
} from '@shared/recording';
import { AdhocTestStepSchema, type AdhocTestStep } from '@shared/schema';

/**
 * Writing a test by describing it.
 *
 * The builder could only be driven by hand or by recording, which means a test exists only
 * after somebody has clicked their way through the application once. A specification, an
 * acceptance criterion or a bug report already says what should happen — in sentences — and
 * all of that had to be retyped as drag-and-drop.
 *
 * What makes this safe is what it is NOT allowed to do. A model here never writes a selector,
 * never invents an action, and never decides what an element is: it chooses from a closed
 * list of actions (ADHOC_ACTION_IDS, the same table the runner implements) and from a
 * catalogue of elements that already exist — the project's repository and whatever the page
 * detection found. Everything it proposes is rebuilt here and validated with
 * AdhocTestStepSchema, the same gate the save and run paths use. A step that comes out of
 * this is a step the runner would have accepted from the builder.
 *
 * The common phrasings are matched by pattern before the model is asked anything, so the
 * obvious sentences cost nothing, work with no API key, and always produce the same steps.
 * The model only ever sees the leftovers.
 *
 * Nothing is silently dropped: every line of the input comes back either as a step or in
 * `unresolved` with the reason. A sentence that quietly disappears is how a test ends up
 * asserting less than its author believes it does.
 */

/** An element a step may target, as offered to the parser and to the model. */
export interface CatalogueEntry {
  /** What the model refers to. Never a selector — there is nothing here to invent. */
  key: string;
  /** How a person would name it: the repository name, or what the page calls the thing. */
  label: string;
  selector: string;
  frameSelector?: string | null;
  tag: string;
  type: string;
  text?: string | null;
  attributes?: Record<string, string>;
  /**
   * Set when this comes from the project's repository, and carried into the step so the test
   * reads the shared definition instead of a copy — see server/step-elements.ts.
   */
  elementId?: string | null;
  origin: 'repository' | 'detected';
}

export interface RepositoryElementInput {
  id: string;
  name: string;
  selector: string;
  frameSelector?: string | null;
  tag?: string | null;
  elementType?: string | null;
  text?: string | null;
  attributes?: unknown;
}

export interface DetectedElementInput {
  id?: string;
  type?: string;
  selector: string;
  frameSelector?: string | null;
  text?: string | null;
  tag?: string;
  attributes?: Record<string, string>;
}

export interface AuthoredStep {
  /** 1-based, counting only the non-empty lines the author wrote. */
  line: number;
  text: string;
  /** Which half of the pipeline produced it, so the preview can say so. */
  source: 'pattern' | 'model';
  step: AdhocTestStep;
}

export interface UnresolvedLine {
  line: number;
  text: string;
  reason: string;
}

export interface AuthoringResult {
  steps: AuthoredStep[];
  unresolved: UnresolvedLine[];
  /** True when the model was actually asked something, so the caller can say it was used. */
  usedModel: boolean;
}

/** What a rule or the model proposes, before it is checked against anything. */
export interface Candidate {
  action: AdhocActionId;
  targetPhrase?: string | null;
  /** Set by the model instead of a phrase: a key from the catalogue. */
  targetKey?: string | null;
  value?: string | null;
}

/** Asks a model for the lines the patterns did not cover. Absent when no key is configured. */
export type ProposeFn = (prompt: string) => Promise<string | null>;

const ACTION_IDS = new Set<string>(ADHOC_ACTION_IDS);

/** Words that name a kind of control rather than the control, dropped when matching. */
const NOUN_WORDS = new Set([
  'button', 'field', 'input', 'link', 'checkbox', 'box', 'menu', 'dropdown', 'icon', 'label',
  'element', 'tab', 'toggle', 'option', 'row', 'column', 'header', 'title', 'text',
  'pulsante', 'bottone', 'campo', 'casella', 'collegamento', 'tendina', 'icona', 'etichetta',
  'elemento', 'scheda', 'riga', 'colonna', 'intestazione', 'titolo', 'testo',
]);

const ARTICLES = new Set([
  'the', 'a', 'an', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'del', 'della',
  'dei', 'delle', 'dello', 'l',
]);

/** What a state is called in the sentence → what the runner calls it. */
const STATE_WORDS: Record<string, string> = {
  checked: 'checked', ticked: 'checked', on: 'checked', selezionato: 'checked', attivo: 'checked',
  unchecked: 'unchecked', off: 'unchecked', deselezionato: 'unchecked', disattivo: 'unchecked',
  enabled: 'enabled', abilitato: 'enabled',
  disabled: 'disabled', disabilitato: 'disabled',
  editable: 'editable', modificabile: 'editable',
  readonly: 'readonly', 'read-only': 'readonly',
  visible: 'visible', visibile: 'visible',
  hidden: 'hidden', nascosto: 'hidden',
};

function canonicalState(word: string): string | null {
  return STATE_WORDS[word.trim().toLowerCase()] ?? null;
}

/**
 * A phrase reduced to what two people would have to agree on to be talking about the same
 * thing: lower case, no quotes or punctuation, no leading article.
 */
export function normaliseLabel(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/["'`]/g, ' ')
    .replace(/[.,;:!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean);
  while (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  return words.join(' ');
}

/** The same phrase without the word that says what kind of control it is. */
function withoutNouns(value: string): string {
  const words = normaliseLabel(value).split(' ').filter(Boolean);
  const kept = words.filter((word) => !NOUN_WORDS.has(word));
  return kept.length > 0 ? kept.join(' ') : words.join(' ');
}

/** A first name for a detected element, from whatever the page called it. */
export function labelForDetected(element: DetectedElementInput, index: number): string {
  const attributes = element.attributes ?? {};
  const candidate =
    (element.text ?? '').trim() ||
    attributes['aria-label'] ||
    attributes.placeholder ||
    attributes.name ||
    attributes.id ||
    attributes.title ||
    '';
  const kind = element.type || element.tag || 'element';
  const label = candidate ? `${candidate.trim()} ${kind}` : `${kind} ${index + 1}`;
  return label.slice(0, 120);
}

/**
 * The elements a sentence is allowed to be about.
 *
 * The repository comes first because those have names somebody chose, and because a step that
 * resolves through one is a step a later repair reaches. Detected elements follow, named after
 * whatever the page shows.
 */
export function buildCatalogue(source: {
  repository?: RepositoryElementInput[];
  detected?: DetectedElementInput[];
}): CatalogueEntry[] {
  const entries: CatalogueEntry[] = [];

  for (const [index, element] of (source.repository ?? []).entries()) {
    entries.push({
      key: `R${index + 1}`,
      label: element.name,
      selector: element.selector,
      frameSelector: element.frameSelector ?? null,
      // Empty rather than a guess: the repository may not know the tag, and an invented one
      // would be read by the `select` rule below as a fact about the control.
      tag: element.tag ?? '',
      type: element.elementType ?? element.tag ?? '',
      text: element.text ?? null,
      attributes: isStringRecord(element.attributes) ? element.attributes : {},
      elementId: element.id,
      origin: 'repository',
    });
  }

  for (const [index, element] of (source.detected ?? []).entries()) {
    entries.push({
      key: `D${index + 1}`,
      label: labelForDetected(element, index),
      selector: element.selector,
      frameSelector: element.frameSelector ?? null,
      tag: element.tag ?? '',
      type: element.type ?? element.tag ?? '',
      text: element.text ?? null,
      attributes: element.attributes ?? {},
      elementId: null,
      origin: 'detected',
    });
  }

  return entries;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export type TargetResolution =
  | { ok: true; entry: CatalogueEntry }
  | { ok: false; reason: string };

/**
 * Which element a phrase is about.
 *
 * Exact first, then the same phrase without the word for the kind of control, then a
 * containment match — and an ambiguous phrase is refused by name rather than resolved to
 * whichever element happened to be listed first. Picking one of three "Save" buttons at
 * random produces a test that passes for a reason nobody intended.
 */
export function resolveTarget(phrase: string, catalogue: CatalogueEntry[]): TargetResolution {
  const wanted = normaliseLabel(phrase);
  if (wanted === '') return { ok: false, reason: 'No element was named in this instruction.' };

  const exact = catalogue.filter(
    (entry) => normaliseLabel(entry.label) === wanted || normaliseLabel(entry.text ?? '') === wanted,
  );
  if (exact.length === 1) return { ok: true, entry: exact[0] };
  if (exact.length > 1) return ambiguous(phrase, exact);

  const bare = withoutNouns(phrase);
  const relaxed = catalogue.filter(
    (entry) => withoutNouns(entry.label) === bare || withoutNouns(entry.text ?? '') === bare,
  );
  if (relaxed.length === 1) return { ok: true, entry: relaxed[0] };
  if (relaxed.length > 1) return ambiguous(phrase, relaxed);

  const contained = catalogue.filter((entry) => {
    const label = normaliseLabel(entry.label);
    const text = normaliseLabel(entry.text ?? '');
    return (
      (label !== '' && (label.includes(wanted) || wanted.includes(label))) ||
      (text !== '' && (text.includes(wanted) || wanted.includes(text)))
    );
  });
  if (contained.length === 1) return { ok: true, entry: contained[0] };
  if (contained.length > 1) return ambiguous(phrase, contained);

  return {
    ok: false,
    reason: `Nothing here is called "${phrase.trim()}". Detect the page's elements, or keep it in the project's element repository under that name.`,
  };
}

function ambiguous(phrase: string, matches: CatalogueEntry[]): TargetResolution {
  const names = matches.slice(0, 4).map((entry) => `"${entry.label}"`).join(', ');
  return {
    ok: false,
    reason: `"${phrase.trim()}" matches ${matches.length} elements (${names}). Name one of them exactly.`,
  };
}

interface Rule {
  regex: RegExp;
  build: (groups: Record<string, string | undefined>) => Candidate | null;
}

/**
 * The phrasings that need no model.
 *
 * Ordered: the specific readings come before the general ones, so "wait for the grid to be
 * visible" is a conditional wait and not a request to pause for "for the grid" milliseconds.
 *
 * English and Italian, because the sentence a test comes from is written in the language the
 * team speaks, and asking somebody to translate their own acceptance criterion into English
 * before it can be automated is exactly the retyping this is meant to remove.
 */
const RULES: Rule[] = [
  {
    regex: /^(?:go to|open|navigate to|browse to|vai (?:a|su|alla|al)|apri)\s+(?<url>\S+)$/i,
    build: (g) => ({ action: 'navigate', value: g.url ?? null }),
  },
  {
    regex: /^(?:wait for (?:the )?(?:network|page) to (?:be idle|settle|go quiet)|attendi (?:che )?la rete(?: sia)? (?:inattiva|ferma))$/i,
    build: () => ({ action: 'waitForNetworkIdle' }),
  },
  {
    regex: /^(?:wait (?:for|until)|attendi(?: che)?|aspetta(?: che)?)\s+(?<target>.+?)\s+(?:to be |to become |is |becomes |sia |diventi |venga )?(?<state>visible|hidden|visibile|nascosto)$/i,
    build: (g) => ({
      action: 'waitForElement',
      targetPhrase: g.target ?? null,
      value: canonicalState(g.state ?? ''),
    }),
  },
  {
    regex: /^(?:wait (?:for|until)|attendi che|aspetta che)\s+(?<target>.+?)\s+(?:to contain|contains|to show|shows|contenga|mostri)\s+"?(?<value>[^"]+?)"?$/i,
    build: (g) => ({ action: 'waitForText', targetPhrase: g.target ?? null, value: g.value ?? null }),
  },
  {
    regex: /^(?:wait|attendi|aspetta)\s+(?<amount>\d+(?:[.,]\d+)?)\s*(?<unit>ms|milliseconds|millisecondi|s|sec|secs|seconds|secondi)?$/i,
    build: (g) => {
      const amount = Number((g.amount ?? '').replace(',', '.'));
      if (!Number.isFinite(amount)) return null;
      // A bare number is read as seconds: nobody writing a test means two milliseconds when
      // they write "wait 2". The preview shows the value in milliseconds, so the reading is
      // visible before the step is inserted.
      const unit = (g.unit ?? 's').toLowerCase();
      const isMilliseconds = unit.startsWith('m');
      return { action: 'wait', value: String(Math.round(isMilliseconds ? amount : amount * 1000)) };
    },
  },
  {
    regex: /^(?:check|assert|verify|make sure|ensure|verifica|controlla)\s+(?:that\s+|che\s+)?(?<target>.+?)\s+(?:contains|shows|displays|contiene|contenga|mostra|mostri)\s+"?(?<value>[^"]+?)"?$/i,
    build: (g) => ({
      action: 'assertTextContains',
      targetPhrase: g.target ?? null,
      value: g.value ?? null,
    }),
  },
  {
    // Deliberately not "make sure": with a state a control can be put into, that means bring
    // it about, and the rule further down does. Here the verb can only mean read it.
    regex: /^(?:check|assert|verify|verifica|controlla)\s+(?:that\s+|che\s+)?(?<target>.+?)\s+(?:is|è|sia)\s+(?<state>checked|unchecked|enabled|disabled|editable|read-?only|selezionato|deselezionato|abilitato|disabilitato|modificabile)$/i,
    build: (g) => ({ action: 'assertState', targetPhrase: g.target ?? null, value: canonicalState(g.state ?? '') }),
  },
  {
    regex: /^(?:check|assert|verify|make sure|ensure|verifica|controlla)\s+(?:that\s+|che\s+)?(?<target>.+?)\s+(?:is visible|is displayed|is present|exists|è visibile|esiste|è presente)$/i,
    build: (g) => ({ action: 'assert', targetPhrase: g.target ?? null }),
  },
  {
    regex: /^(?:make sure|ensure|set|assicurati che|imposta)\s+(?:that\s+|che\s+)?(?<target>.+?)\s+(?:is\s+|è\s+|sia\s+)?(?<state>checked|unchecked|ticked|on|off|selezionato|deselezionato|attivo|disattivo)$/i,
    build: (g) => ({ action: 'ensureState', targetPhrase: g.target ?? null, value: canonicalState(g.state ?? '') }),
  },
  {
    regex: /^(?:type|enter|fill in|fill|input|scrivi|inserisci|digita)\s+"(?<value>[^"]*)"\s+(?:in(?:to)?|nel|nella|su)\s+(?<target>.+)$/i,
    build: (g) => ({ action: 'input', targetPhrase: g.target ?? null, value: g.value ?? '' }),
  },
  {
    regex: /^(?:type|enter|fill in|fill|input|scrivi|inserisci|digita)\s+(?<value>.+?)\s+(?:into|in the|nel campo|nella casella|nel|nella)\s+(?<target>.+)$/i,
    build: (g) => ({ action: 'input', targetPhrase: g.target ?? null, value: g.value ?? '' }),
  },
  {
    regex: /^(?:select|choose|pick|seleziona|scegli)\s+"?(?<value>[^"]+?)"?\s+(?:from|in|da|dal|dalla|nel|nella)\s+(?<target>.+)$/i,
    build: (g) => ({ action: 'select', targetPhrase: g.target ?? null, value: g.value ?? null }),
  },
  {
    regex: /^(?:hover(?: over| on)?|passa (?:il mouse )?sopra|passa il mouse su)\s+(?<target>.+)$/i,
    build: (g) => ({ action: 'hover', targetPhrase: g.target ?? null }),
  },
  {
    regex: /^(?:click(?: on)?|press|tap|clicca(?: su)?|premi|fai click su)\s+(?<target>.+)$/i,
    build: (g) => ({ action: 'click', targetPhrase: g.target ?? null }),
  },
  {
    regex: /^(?:scroll(?: down)?(?: the page)?|scorri(?: la pagina)?)$/i,
    build: () => ({ action: 'scroll' }),
  },
];

/** The lines an author wrote, without the blank ones and without list numbering. */
export function splitInstructions(text: string): { line: number; text: string }[] {
  const lines: { line: number; text: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const cleaned = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (cleaned === '') continue;
    lines.push({ line: lines.length + 1, text: cleaned });
  }
  return lines;
}

/** One instruction read by pattern, or nothing — in which case the model gets a turn. */
export function parseLine(text: string): Candidate | null {
  const cleaned = text.trim().replace(/[.;]+$/, '');
  for (const rule of RULES) {
    const match = rule.regex.exec(cleaned);
    if (!match) continue;
    const candidate = rule.build(match.groups ?? {});
    if (candidate) return candidate;
  }
  return null;
}

export type StepBuild = { ok: true; step: AdhocTestStep } | { ok: false; reason: string };

/**
 * A candidate turned into a step, or refused with the reason.
 *
 * Everything a proposal can get wrong is caught here: an action nobody implements, a missing
 * element, a value an action does not accept. The last word belongs to AdhocTestStepSchema,
 * which is what the builder's own steps are checked against — so this cannot produce a step
 * the rest of the system would reject.
 */
export function buildStep(candidate: Candidate, catalogue: CatalogueEntry[]): StepBuild {
  if (!ACTION_IDS.has(candidate.action)) {
    return { ok: false, reason: `"${candidate.action}" is not something this runner can do.` };
  }
  let action = candidate.action;
  const requirements = ACTION_REQUIREMENTS[action];

  let entry: CatalogueEntry | undefined;
  if (requirements.target) {
    if (candidate.targetKey) {
      entry = catalogue.find((item) => item.key === candidate.targetKey);
      if (!entry) return { ok: false, reason: 'That element is not on this page or in the repository.' };
    } else {
      const resolution = resolveTarget(candidate.targetPhrase ?? '', catalogue);
      if (!resolution.ok) return { ok: false, reason: resolution.reason };
      entry = resolution.entry;
    }
  }

  // A native <select> is driven by its option; anything else that behaves like a dropdown —
  // an Angular Material control, a listbox built out of divs — has to be opened and clicked.
  // The sentence says "select X from Y" either way, so the element decides, not the author.
  if (action === 'select' && entry && entry.tag.toLowerCase() !== 'select') {
    action = 'selectByText';
  }

  let value = candidate.value ?? null;
  if (typeof value === 'string') value = value.trim();

  const options = ACTION_VALUE_OPTIONS[action];
  if (options && value) {
    const matched = options.find((option) => option.toLowerCase() === value!.toLowerCase());
    if (!matched) return { ok: false, reason: `"${value}" is not one of: ${options.join(', ')}.` };
    value = matched;
  }

  if (action === 'navigate' && value && !/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    // "go to example.com" is a URL with the scheme left off, which is how people write them.
    value = `https://${value}`;
  }

  const step = {
    id: uuidv4(),
    action: {
      id: action,
      type: action,
      // i18n keys, exactly as the palette builds them, so a step made here is labelled by the
      // same table as one dragged in by hand.
      name: ACTION_I18N[action].name,
      icon: ACTION_I18N[action].icon,
      description: ACTION_I18N[action].description,
    },
    ...(entry
      ? {
          targetElement: {
            id: entry.elementId ?? entry.key,
            type: entry.type,
            selector: entry.selector,
            frameSelector: entry.frameSelector ?? null,
            text: entry.text ?? null,
            tag: entry.tag,
            attributes: entry.attributes ?? {},
            // Set only for a repository element: the step then reads the shared definition at
            // run time, so a repair reaches this test too.
            ...(entry.elementId ? { elementId: entry.elementId } : {}),
          },
        }
      : {}),
    ...(requirements.value && value !== null && value !== '' ? { value } : {}),
  } as AdhocTestStep;

  const parsed = AdhocTestStepSchema.safeParse(step);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, reason: first?.message ?? 'This instruction does not make a valid step.' };
  }
  // The step itself, not what the schema returns: parsing strips `elementId`, and resolving
  // through the repository is the whole point of having set it.
  return { ok: true, step };
}

/**
 * What the model is told.
 *
 * It gets the actions and the element keys, and nothing else. There is no selector in this
 * prompt, so there is no selector it can be tempted to improve on.
 */
export function buildPrompt(lines: { line: number; text: string }[], catalogue: CatalogueEntry[]): string {
  const actions = ADHOC_ACTION_IDS.map((id) => {
    const requirements = ACTION_REQUIREMENTS[id];
    const options = ACTION_VALUE_OPTIONS[id];
    const parts = [
      requirements.target ? 'needs an element' : 'no element',
      requirements.valueRequired ? 'needs a value' : requirements.value ? 'optional value' : 'no value',
    ];
    if (options) parts.push(`value is one of: ${options.join(' | ')}`);
    return `- ${id} (${parts.join('; ')})`;
  }).join('\n');

  const elements = catalogue
    .map((entry) => `- ${entry.key}: ${entry.label}${entry.tag ? ` <${entry.tag}>` : ''}`)
    .join('\n');

  const instructions = lines.map((item) => `${item.line}. ${item.text}`).join('\n');

  return [
    'You turn one sentence into one test step. You do not write selectors and you do not invent elements.',
    '',
    'Actions you may use, and nothing else:',
    actions,
    '',
    elements === '' ? 'Elements available: none.' : `Elements available, by key:\n${elements}`,
    '',
    'Instructions:',
    instructions,
    '',
    'Answer with a JSON array and nothing else. One object per instruction you understood:',
    '[{"line": 1, "action": "click", "element": "D3", "value": null}]',
    'Use "element" only with a key from the list above. Leave out an instruction you cannot',
    'express with these actions and these elements — a wrong step is worse than a missing one.',
    'For a wait, "value" is milliseconds. For navigate, "value" is the URL.',
  ].join('\n');
}

/**
 * The model's answer, read defensively.
 *
 * Anything that is not a well-formed proposal about one of the lines we asked about is dropped
 * here, so a model that returns prose, fences its JSON, or answers about a line that does not
 * exist costs a missing step and never a wrong one.
 */
export function parseModelResponse(
  raw: string | null | undefined,
  allowedLines: Set<number>,
): Map<number, Candidate> {
  const proposals = new Map<number, Candidate>();
  if (!raw) return proposals;

  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return proposals;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return proposals;
  }
  if (!Array.isArray(parsed)) return proposals;

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const line = Number(record.line);
    const action = typeof record.action === 'string' ? record.action : '';
    if (!Number.isInteger(line) || !allowedLines.has(line)) continue;
    if (!ACTION_IDS.has(action)) continue;
    if (proposals.has(line)) continue;
    proposals.set(line, {
      action: action as AdhocActionId,
      targetKey: typeof record.element === 'string' ? record.element : null,
      value:
        typeof record.value === 'string'
          ? record.value
          : typeof record.value === 'number'
            ? String(record.value)
            : null,
    });
  }
  return proposals;
}

export interface AuthoringInput {
  text: string;
  repository?: RepositoryElementInput[];
  detected?: DetectedElementInput[];
}

/** Sentences in, steps out — with an account of every sentence that did not become one. */
export async function authorSteps(
  input: AuthoringInput,
  deps: { propose?: ProposeFn } = {},
): Promise<AuthoringResult> {
  const catalogue = buildCatalogue({ repository: input.repository, detected: input.detected });
  const lines = splitInstructions(input.text);

  const steps: AuthoredStep[] = [];
  const unresolved: UnresolvedLine[] = [];
  const leftovers: { line: number; text: string }[] = [];
  const byLine = new Map<number, { candidate: Candidate; source: 'pattern' | 'model' }>();

  for (const item of lines) {
    const candidate = parseLine(item.text);
    if (candidate) byLine.set(item.line, { candidate, source: 'pattern' });
    else leftovers.push(item);
  }

  let usedModel = false;
  if (leftovers.length > 0 && deps.propose) {
    usedModel = true;
    const allowed = new Set(leftovers.map((item) => item.line));
    let answer: string | null = null;
    try {
      answer = await deps.propose(buildPrompt(leftovers, catalogue));
    } catch {
      // A model that is down is a feature that degrades, not a request that fails: the
      // pattern-matched steps still come back, and the rest are reported as unread.
      answer = null;
    }
    for (const [line, candidate] of parseModelResponse(answer, allowed)) {
      byLine.set(line, { candidate, source: 'model' });
    }
  }

  for (const item of lines) {
    const proposal = byLine.get(item.line);
    if (!proposal) {
      unresolved.push({
        line: item.line,
        text: item.text,
        reason: deps.propose
          ? 'Neither the phrasings this understands nor the model could express this as one step.'
          : 'This phrasing is not one of the ones understood without a model. Set GEMINI_API_KEY to allow free-form sentences.',
      });
      continue;
    }
    const built = buildStep(proposal.candidate, catalogue);
    if (!built.ok) {
      unresolved.push({ line: item.line, text: item.text, reason: built.reason });
      continue;
    }
    steps.push({ line: item.line, text: item.text, source: proposal.source, step: built.step });
  }

  return { steps, unresolved, usedModel };
}
