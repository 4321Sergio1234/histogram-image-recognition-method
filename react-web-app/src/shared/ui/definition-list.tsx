import type { ReactNode } from 'react';

export interface DefinitionItem {
  label: string;
  value: ReactNode;
  wrap?: boolean;
}

export function DefinitionList({ items }: { items: readonly DefinitionItem[] }) {
  return (
    <dl className="definition-list">
      {items.map(({ label, value, wrap }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd style={wrap ? { overflowWrap: 'anywhere' } : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
