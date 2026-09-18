const UPLOAD_PATH = '/image/upload/';

// Cloudinary delivery URL for the size actually being drawn.
//
// Photos are stored at 512px (backend/src/utils/cloudinary.js) and were then loaded
// whole into 44px circles: a 32-name member list pulled about a megabyte of mobile
// data to fill a column of thumbnails. Asking the CDN for the box size instead is a
// URL rewrite, no re-upload, and nothing else in the app has to know.
//
// Anything that is not a Cloudinary upload URL is returned untouched, so a
// placeholder, a blob: URL or a logo served from elsewhere still works.
export function sizedImage(url, { w, h, fit = 'fill' } = {}) {
  const src = String(url || '');
  if (!src || !w || !src.includes(UPLOAD_PATH)) return src;

  const params = [`w_${w}`, h ? `h_${h}` : '', `c_${fit}`, 'q_auto', 'f_auto']
    .filter(Boolean)
    .join(',');

  return src.replace(UPLOAD_PATH, `${UPLOAD_PATH}${params}/`);
}

// The avatar is drawn at 32/44/64px; asking for twice the box keeps it sharp on a
// 3x phone without going back to the full 512px asset.
export const AVATAR_PX = { sm: 64, md: 88, lg: 128 };

// The group's logo is drawn at 36–40px in the header and about 64px in Settings.
export const LOGO_PX = { header: 96, preview: 160 };
