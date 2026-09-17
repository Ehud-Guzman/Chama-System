const multer = require('multer');

// Documents are written straight into MongoDB (see models/ChamaDocument), so an
// upload only ever lives in memory between the request and the insert. 8 MB is
// comfortably above a phone photo or scan of a title deed/certificate while
// staying well under Mongo's 16 MB per-document ceiling.
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const ALLOWED_MIME_PREFIXES = ['image/'];

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
];

function fileTypeAllowed(mimetype) {
  if (ALLOWED_MIME_PREFIXES.some((prefix) => String(mimetype).startsWith(prefix))) return true;
  return ALLOWED_MIME_TYPES.includes(mimetype);
}

function rejectUpload(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter(req, file, cb) {
    if (fileTypeAllowed(file.mimetype)) return cb(null, true);
    return cb(
      rejectUpload('That file type is not supported. Upload a PDF, a Word/Excel document, or a photo.')
    );
  },
});

// Profile photos: images only, and a smaller cap than documents — a phone photo
// of a person is nowhere near the 8 MB a scanned title deed can reach.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES },
  fileFilter(req, file, cb) {
    if (String(file.mimetype).startsWith('image/')) return cb(null, true);
    return cb(rejectUpload('That file is not an image. Upload a JPG, PNG or HEIC photo.'));
  },
});

// Wraps a configured multer instance so its own failure modes (file too large,
// rejected type) come back as clean JSON instead of falling through to the 500
// handler.
function singleField(instance, maxBytes, field) {
  return (req, res, next) => {
    instance.single(field)(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          message: `That file is too large. The limit is ${Math.round(maxBytes / (1024 * 1024))} MB.`,
        });
      }
      return res
        .status(err.status || 400)
        .json({ message: err.message || 'Could not read the uploaded file' });
    });
  };
}

// Field name is passed in because both call sites use `file`, but keeping it a
// parameter avoids a silent mismatch if one of them ever changes.
function uploadSingle(field) {
  return singleField(documentUpload, MAX_FILE_BYTES, field);
}

function uploadImageSingle(field) {
  return singleField(photoUpload, MAX_PHOTO_BYTES, field);
}

module.exports = { uploadSingle, uploadImageSingle, MAX_FILE_BYTES, MAX_PHOTO_BYTES };
