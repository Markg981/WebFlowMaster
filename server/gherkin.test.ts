import { describe, expect, it } from 'vitest';
import { parseGherkin, exportGherkin } from './gherkin';

describe('Gherkin files', () => {
  it('expands backgrounds, outlines and examples into manual tests, retaining tags', () => {
    const result = parseGherkin(`@smoke
Feature: Login
  Background:
    Given a browser
  @auth
  Scenario Outline: Login as <user>
    When I sign in as <user>
    Then I see <user>
    Examples:
      | user |
      | Alice |
      | Bob |`);
    expect(result.tests).toHaveLength(2);
    expect(result.tests[0].name).toBe('Login / Login as Alice [1]');
    const sequence = result.tests[0].sequence as any[];
    expect(sequence.map(s => s.value)).toEqual(['Given a browser', 'When I sign in as Alice', 'Then I see Alice']);
    expect(sequence.every(s => s.action.id === 'manualStep')).toBe(true);
    expect(sequence[2].expected).toBe('I see Alice');
    expect(sequence[0].gherkin.tags).toEqual(['@smoke', '@auth']);
  });
  it.each(['Rule: grouping', 'Given a step\n | data |', 'Given a step\n """\n doc\n """', '# language: it\nFunzionalità: Accesso'])('rejects unsupported syntax explicitly: %s', text => {
    expect(() => parseGherkin(`Feature: F\nScenario: S\n${text}`)).toThrow();
  });
  it('rejects missing examples and unresolved parameters', () => {
    expect(() => parseGherkin('Feature: F\nScenario Outline: S\nGiven <x>')).toThrow(/Examples/);
    expect(() => parseGherkin('Feature: F\nScenario Outline: S\nGiven <x>\nExamples:\n| y |\n| a |')).toThrow(/parameter/);
  });
  it('round trips actual automated actions and web-test fields through explicit metadata', () => {
    const test = { name: 'Save', url: 'https://example.test', sequence: [{ id: 'a', action: { id: 'click', name: 'Click' }, value: '#save' }], dataset: [{ user: 'Alice' }] };
    const exported = exportGherkin({ project: 'App', tests: [test] });
    expect(exported.content).toContain('Scenario: Save');
    expect(parseGherkin(exported.content).tests[0]).toEqual(test);
    expect(() => parseGherkin(exported.content.replace('When Click: #save', 'When changed'))).toThrow(/metadata/);
  });
  it('rejects duplicate scenario names rather than overwriting a test', () => {
    expect(() => parseGherkin('Feature: F\nScenario: S\nGiven a\nScenario: S\nGiven b')).toThrow(/Duplicate/);
  });
});
