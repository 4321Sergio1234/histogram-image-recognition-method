export function ValueTrack({
  value,
  className,
  as: Tag = 'span',
}: {
  value: number;
  className: string;
  as?: 'span' | 'div';
}) {
  return (
    <Tag className={className} aria-hidden="true">
      <span style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </Tag>
  );
}
