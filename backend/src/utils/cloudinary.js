const { v2: cloudinary } = require('cloudinary');

// Member profile photos live on Cloudinary rather than in MongoDB: they're
// served straight from their CDN (so a list of 32 members doesn't drag 32 image
// blobs through the API), and the transformation below means we never store the
// 3–5 MB original a phone camera produces.
const FOLDER = process.env.CLOUDINARY_FOLDER || 'chama-system/members';
const AVATAR_PX = 512;

// The group's logo: one image for the whole app rather than a photo per member,
// so it gets its own folder (never mixed in with the members' pictures) and a
// gentler transformation. `limit` never enlarges a small upload, and there is no
// face crop — `gravity: face` on a wordmark is what cuts the ends off a name.
const LOGO_FOLDER = process.env.CLOUDINARY_BRANDING_FOLDER || 'chama-system/branding';
const LOGO_MAX_PX = 512;

function isCloudinaryConfigured() {
  // Either a single CLOUDINARY_URL (cloudinary://key:secret@cloud) or the trio.
  return Boolean(
    process.env.CLOUDINARY_URL ||
      (process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET)
  );
}

function ensureConfigured() {
  if (!isCloudinaryConfigured()) {
    const err = new Error(
      'Photo uploads are not set up yet. Set CLOUDINARY_URL, or CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET, in the server environment.'
    );
    err.status = 503;
    throw err;
  }

  if (process.env.CLOUDINARY_URL) {
    // The SDK parses CLOUDINARY_URL itself — passing the individual values here
    // as well would only create a second, competing source of truth.
    cloudinary.config({ secure: true });
    return;
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

// Streams an in-memory upload to Cloudinary: square, face-centred, 512px,
// auto-format/quality. Resolves with the permanent URL plus the publicId, which
// is what a later replace/delete needs to clean the old asset up.
function uploadMemberPhoto(buffer) {
  ensureConfigured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: FOLDER,
        resource_type: 'image',
        transformation: [
          {
            width: AVATAR_PX,
            height: AVATAR_PX,
            crop: 'fill',
            gravity: 'face',
            quality: 'auto',
            fetch_format: 'auto',
          },
        ],
      },
      (err, result) => {
        if (err) {
          err.status = err.http_code && err.http_code >= 400 && err.http_code < 500 ? 400 : 502;
          return reject(err);
        }
        return resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

// The group's logo, streamed to Cloudinary from memory like a member photo.
// Resolves with the permanent URL plus the publicId, which is what a later
// replace or removal needs to clean the old asset up.
function uploadGroupLogo(buffer) {
  ensureConfigured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: LOGO_FOLDER,
        resource_type: 'image',
        transformation: [
          {
            width: LOGO_MAX_PX,
            height: LOGO_MAX_PX,
            crop: 'limit',
            quality: 'auto',
            fetch_format: 'auto',
          },
        ],
      },
      (err, result) => {
        if (err) {
          err.status = err.http_code && err.http_code >= 400 && err.http_code < 500 ? 400 : 502;
          return reject(err);
        }
        return resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

// Best-effort cleanup — a failed delete must never fail the request that
// triggered it, it only ever leaves one orphaned image behind.
async function destroyImage(publicId) {
  if (!publicId || !isCloudinaryConfigured()) return false;
  try {
    await cloudinary.uploader.destroy(publicId);
    return true;
  } catch (err) {
    console.error(`Cloudinary delete failed (${publicId}):`, err.message);
    return false;
  }
}

module.exports = { isCloudinaryConfigured, uploadMemberPhoto, uploadGroupLogo, destroyImage };