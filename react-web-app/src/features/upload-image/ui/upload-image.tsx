import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/shared/ui';

const COPY = { choose: 'Choose image', picker: 'Choose an image file' } as const;

export function UploadImage({
  onSelect,
  disabled = false,
  variant = 'primary',
  label = COPY.choose,
}: {
  onSelect: (file: File) => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'text';
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={COPY.picker}
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onSelect(file);
          }
          event.target.value = '';
        }}
      />
      <Button
        variant={variant}
        disabled={disabled}
        onClick={() => input.current?.click()}
        icon={<Upload size={18} />}
      >
        {label}
      </Button>
    </>
  );
}
