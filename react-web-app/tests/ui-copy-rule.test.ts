import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import uiCopyRule from '../../scripts/lint/ui-copy-rule.js';

const linter = new Linter();
function violations(source: string) {
  return linter.verify(source, [
    {
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      plugins: { horizon: { rules: { 'ui-copy': uiCopyRule } } },
      rules: { 'horizon/ui-copy': 'error' },
    },
  ]);
}

describe('component copy lint rule', () => {
  it.each([
    '<button>Analyze image</button>',
    '<button aria-label="Analyze image" />',
    '<Dialog title="Analysis details" />',
    '<span>{ready ? "Ready" : "Loading"}</span>',
    '<span>{ready && "Ready"}</span>',
    '<span>{`Model ${version}`}</span>',
    '<span>{elapsed + " ms"}</span>',
    '<img alt={ready ? "Selected photo" : "Preview"} />',
  ])('rejects visible inline copy in %s', (jsx) => {
    const messages = violations(`const view = ${jsx};`);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((message) => message.ruleId === 'horizon/ui-copy')).toBe(true);
  });

  it('allows copy references, metadata, whitespace and structural attributes', () => {
    expect(
      violations(`
      const COPY = { action: 'Analyze image' };
      const view = <button className="button" type="button" aria-label={COPY.action}>
        {COPY.action}{' '}{result.label}<img alt="" src="/icon.svg" />
      </button>;
    `),
    ).toEqual([]);
  });

  it('does not mistake condition discriminants or class names for visible copy', () => {
    expect(
      violations(`const view = <span className={status === 'ready' ? 'ready' : ''}>
      {status === 'ready' ? COPY.ready : COPY.loading}
    </span>;`),
    ).toEqual([]);
  });
});
