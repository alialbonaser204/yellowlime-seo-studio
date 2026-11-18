import book from '../assets/avatars/avatar-book.webp';
import lime from '../assets/avatars/avatar-lime.webp';
import mark from '../assets/avatars/avatar-mark.webp';
import sparkles from '../assets/avatars/avatar-sparkles.webp';
import team from '../assets/avatars/avatar-team.webp';
import user from '../assets/avatars/avatar-user.webp';

/** Icons a Yellowlimer can pick instead of a photo. 'Lemon' is the Yellowlime mark. */
export const AVATAR_ICONS = ['Lemon', 'Lime', 'UserCircle', 'Users', 'Sparkles', 'BookOpen'] as const;
export const DEFAULT_AVATAR_ICON = 'Lemon';

const SOURCES: Record<string, string> = {
  Lemon: mark,
  Lime: lime,
  UserCircle: user,
  Users: team,
  Sparkles: sparkles,
  BookOpen: book,
};

const LABELS: Record<string, string> = {
  Lemon: 'Yellowlime',
  Lime: 'Limoen',
  UserCircle: 'Persoon',
  Users: 'Team',
  Sparkles: 'Sterren',
  BookOpen: 'Boek',
};

export function avatarIconLabel(value: string): string {
  return LABELS[value] ?? 'Persoon';
}

/** The icon tile itself; `size` is the width and height in pixels. */
export function AvatarIcon({ value, size }: { value: string; size: number }) {
  const src = SOURCES[value] ?? user;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.22), display: 'block', flex: 'none' }}
    />
  );
}
