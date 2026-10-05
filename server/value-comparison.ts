function compareCount(operator: string, actual: number, expected: number): boolean | null {
  switch (operator) {
    case '==': return actual === expected;
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
    case '>': return actual > expected;
    case '<': return actual < expected;
    case '!=': return actual !== expected;
    default: return null;
  }
}

export function compareValues(expression: string): { value: boolean } | { error: string } {
  const text = expression.trim();
  if (/^true$/i.test(text)) return { value: true };
  if (/^false$/i.test(text)) return { value: false };

  const words = /^(.*?)\s+(not contains|contains)\s+(.*)$/is.exec(text);
  if (words) {
    const found = words[1].trim().includes(words[3].trim());
    return { value: words[2].toLowerCase() === 'contains' ? found : !found };
  }

  const symbols = /^(.*?)\s*(==|!=|>=|<=|>|<)\s*(.*)$/s.exec(text);
  if (!symbols) {
    return { error: `"${expression}" is not a comparison. Write it as left == right, !=, >, <, >=, <=, contains or not contains.` };
  }
  const [, rawLeft, operator, rawRight] = symbols;
  const left = rawLeft.trim();
  const right = rawRight.trim();
  if (operator === '==') return { value: left === right };
  if (operator === '!=') return { value: left !== right };
  const a = Number(left);
  const b = Number(right);
  if (left === '' || right === '' || Number.isNaN(a) || Number.isNaN(b)) {
    return { error: `"${left}" ${operator} "${right}" compares values that are not both numbers.` };
  }
  return { value: compareCount(operator, a, b) ?? false };
}
