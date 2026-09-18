const {
  uploadMemberPhoto,
  uploadGroupLogo,
  isCloudinaryConfigured,
  destroyImage,
  MEMBER_FOLDER,
  LOGO_FOLDER,
} = require('../utils/cloudinary');
const { logAudit } = require('../utils/auditLogger');

// POST /api/uploads/member-photo — ADMIN/treasurer, multipart (field: `file`).
// The browser uploads here rather than straight to Cloudinary so the API secret
// stays on the server and the crop/compression settings can't be tampered with
// from the client.
async function uploadPhoto(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Choose a photo to upload' });
    }
    const { url, publicId } = await uploadMemberPhoto(req.file.buffer);
    res.status(201).json({ url, publicId });
  } catch (err) {
    next(err);
  }
}

// POST /api/uploads/chama-logo — ADMIN, multipart (field: `file`). The group's
// logo, on the same proxied path as a member photo: the API secret stays on the
// server and the compression settings can't be tampered with from the browser.
// The URL comes back to the settings form, which saves the pair with the rest of
// the settings.
async function uploadLogo(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Choose an image to upload' });
    }
    const { url, publicId } = await uploadGroupLogo(req.file.buffer);
    res.status(201).json({ url, publicId });
  } catch (err) {
    next(err);
  }
}

// GET /api/uploads/status — lets the member form tell an admin why the photo
// picker is disabled instead of failing on submit.
async function uploadStatus(req, res) {
  res.json({ cloudinaryConfigured: isCloudinaryConfigured() });
}

// POST /api/uploads/member-photo/remove — ADMIN/treasurer. Deletes the Cloudinary
// asset for a member's current photo (by its publicId). The member record itself
// is cleared separately by the caller (MemberDetail removes photoUrl/photoPublicId
// in the same request), so a failed Cloudinary delete never leaves the database
// pointing at a non-existent image.
async function removePhoto(req, res, next) {
  try {
    const { publicId } = req.body || {};
    if (!publicId) {
      return res.status(400).json({ message: 'No photo to remove' });
    }

    // Scoped to this app's own folders. The id arrives in the request, and without
    // this check any admin could delete *any* asset in the Cloudinary account by
    // passing its publicId — the group's logo, or another member's photo.
    const id = String(publicId);
    const owned = [MEMBER_FOLDER, LOGO_FOLDER].some((prefix) => id.startsWith(`${prefix}/`));
    if (!owned) {
      return res.status(403).json({ message: 'That image does not belong to this app.' });
    }

    // Best-effort: a failed destroy must never block the request. The orphaned
    // image gets cleaned up on the next successful re-upload.
    await destroyImage(id).catch(() => {});

    await logAudit({
      action: 'delete',
      entityType: 'Member',
      // This route clears an image, not a member — the caller patches the member
      // record itself — so the trail names the asset that went.
      entityId: req.user._id,
      performedBy: req.user._id,
      before: { removedPhotoPublicId: id },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadPhoto, uploadLogo, uploadStatus, removePhoto };