import { useRef } from 'react';
import { Upload } from 'lucide-react';

export function UploadImage({
  onSelect,
  disabled = false,
  variant = 'primary',
  label = 'Choose image',
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
        aria-label="Choose an image file"
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
      <button
        type="button"
        className={`button button-${variant}`}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Upload size={18} />
        {label}
      </button>
    </>
  );
}
