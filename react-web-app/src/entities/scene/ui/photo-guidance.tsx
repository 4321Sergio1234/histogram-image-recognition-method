import { Focus, SunMedium, UserX } from 'lucide-react';
import { PHOTO_GUIDANCE } from '../config/photo-guidance';

const ICONS = { framing: Focus, lighting: SunMedium, foreground: UserX };

export function PhotoGuidance() {
  return (
    <div className="photo-tips">
      {PHOTO_GUIDANCE.map(({ id, title, summary }) => {
        const Icon = ICONS[id];
        return (
          <div key={id}>
            <span>
              <Icon size={19} />
            </span>
            <p>
              <strong>{title}</strong>
              {summary}
            </p>
          </div>
        );
      })}
    </div>
  );
}
