import { AVATAR_PX, sizedImage } from '../../utils/imageUrl';

// Profile photo with an initials fallback. A list where half the photos are
// missing shouldn't look broken, and initials are easier to scan than a row of
// identical silhouette icons.
//
// The photo is requested from the CDN at the size the avatar is drawn: the asset on
// Cloudinary is 512px, and loading it whole into a 44px circle meant a 32-name
// members' list pulled about a megabyte of mobile data to fill one column.
export default function MemberAvatar({ name, photoUrl, size = 'md', className = '' }) {
  const sizes = {
    sm: 'h-8 w-8 text-[11px]',
    md: 'h-11 w-11 text-sm',
    lg: 'h-16 w-16 text-xl',
  };

  const initials = String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

  const base = `${sizes[size] || sizes.md} shrink-0 rounded-full ${className}`;

  if (photoUrl) {
    const px = AVATAR_PX[size] || AVATAR_PX.md;
    return (
      <img
        src={sizedImage(photoUrl, { w: px, h: px })}
        alt=""
        loading="lazy"
        decoding="async"
        width={px}
        height={px}
        className={`${base} object-cover`}
      />
    );
  }

  // aria-hidden: the member's name is always rendered next to the avatar, so the
  // initials would only be read out twice.
  return (
    <span
      aria-hidden="true"
      className={`${base} flex items-center justify-center bg-primary/10 font-semibold text-primary`}
    >
      {initials || '?'}
    </span>
  );
}