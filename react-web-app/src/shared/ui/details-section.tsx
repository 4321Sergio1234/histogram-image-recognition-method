import type { ComponentProps } from 'react';

type DetailsSectionProps = ComponentProps<'section'> & { title: string };

export function DetailsSection({ title, children, className = '', ...props }: DetailsSectionProps) {
  return (
    <section className={`details-section ${className}`.trim()} {...props}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
