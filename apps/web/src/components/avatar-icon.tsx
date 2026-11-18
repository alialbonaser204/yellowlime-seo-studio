import { BookOpen, Sparkles, UserCircle, Users } from 'lucide-react';
import brandMark from '../assets/yellowlime-mark.png';

/** Icons a Yellowlimer can pick instead of a photo. 'Lemon' is the Yellowlime mark. */
export const AVATAR_ICONS = ['Lemon', 'UserCircle', 'Users', 'Sparkles', 'BookOpen'] as const;
export const DEFAULT_AVATAR_ICON = 'Lemon';

export function AvatarIcon({ value, size }: { value: string; size: number }) {
  if (value === 'Lemon') {
    return (
      <span className="lemon-avatar" style={{ width: size * 1.7, height: size * 1.7 }} aria-hidden="true">
        <img src={brandMark} alt="" style={{ width: size * 1.15, height: size * 1.15 }} />
      </span>
    );
  }
  if (value === 'Sparkles') return <Sparkles size={size} />;
  if (value === 'BookOpen') return <BookOpen size={size} />;
  if (value === 'Users') return <Users size={size} />;
  return <UserCircle size={size} />;
}
