import type { ReactNode } from 'react';

export interface Instruction {
  title: string;
  description: ReactNode;
}

export function InstructionList({ items }: { items: readonly Instruction[] }) {
  return (
    <ol className="method-steps">
      {items.map(({ title, description }) => (
        <li key={title}>
          <strong>{title}</strong>
          <p>{description}</p>
        </li>
      ))}
    </ol>
  );
}
