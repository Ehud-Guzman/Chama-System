const multer = require('multer');

// Documents are written straight into MongoDB (see models/ChamaDocument), so an
// upload only ever lives in memory between the request and the insert. 8 MB is
// comfortably above a phone photo or scan of a title deed/certificate while
// staying well under Mongo's 16 MB per-document ceiling.
const MAX_FILE_BYTES = 8 * 1024 * 1024;

// What a client claims its file is. Used only to decide which signature to expect
// — the bytes below are the authority, because a multipart Content-Type is whatever
// the client felt like typing, and these files are stored and then served back from
// our own origin.
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

// SVG is an image *and* a script container: it can carry <script>, and these files
// are served inline from our origin. Nothing in this vault needs one, so it is
// refused rather than special-cased — the same reasoning as refusing HTML.
const REJECTED_MIME_TYPES = ['image/svg+xml', 'image/svg', 'text/html', 'application/xhtml+xml'];

const PDF = (b) => b.length > 4 && b.subarray(0, 4).toString('latin1') === '%PDF';
const JPEG = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const PNG = (b) =>
  b.length > 8 &&
  b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const GIF = (b) => b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'));
const WEBP = (b) =>
  b.length > 12 &&
  b.subarray(0, 4).toString('latin1') === 'RIFF' &&
  b.subarray(8, 12).toString('latin1') === 'WEBP';
// HEIC/HEIF, which is what an iPhone camera produces by default.
const ISO_BMFF = (b) => b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp';
// .docx / .xlsx / .pptx are ZIP containers.
const ZIP = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;
// .doc / .xls / .ppt are the old OLE compound format.
const OLE = (b) =>
  b.length > 8 &&
  b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));

// Text and CSV have no magic number, so they are judged by what they are not: a
// binary pretending to be a spreadsheet is full of control bytes, and a real CSV of
// a member roster is not.
function looksLikeText(buffer) {
  const sample = buffer.subarray(0, 4096);
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c) return false;
    if (byte === 0x7f) return false;
  }
  return sample.length > 0;
}

// Which family the bytes actually are, independent of the claim.
function detectedFamily(buffer) {
  if (PDF(buffer)) return 'pdf';
  if (JPEG(buffer)) return 'jpeg';
  if (PNG(buffer)) return 'png';
  if (GIF(buffer)) return 'gif';
  if (WEBP(buffer)) return 'webp';
  if (ISO_BMFF(buffer)) return 'heif';
  if (ZIP(buffer)) return 'zip';
  if (OLE(buffer)) return 'ole';
  if (looksLikeText(buffer)) return 'text';
  return 'unknown';
}

// The families a declared type is allowed to turn out to be.
const EXPECTED_FAMILIES = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/heic': ['heif'],
  'image/heif': ['heif'],
  'application/msword': ['ole', 'zip'],
  'application/vnd.ms-excel': ['ole', 'zip'],
  'application/vnd.ms-powerpoint': ['ole', 'zip'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['zip'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['zip'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['zip'],
  'text/plain': ['text'],
  'text/csv': ['text'],
};

function fileTypeAllowed(mimetype) {
  const declared = String(mimetype || '').toLowerCase();
  if (REJECTED_MIME_TYPES.includes(declared)) return false;
  if (ALLOWED_MIME_PREFIXES.some((prefix) => declared.startsWith(prefix))) return true;
  return ALLOWED_MIME_TYPES.includes(declared);
}

function rejectUpload(message) {
  const err = new Error(message);
  err.status = 400;
  // Written for a person to read, so the error handler shows it as it stands.
  err.expose = true;
  return err;
}

// Runs once the whole file is in memory: the declared type said what to expect,
// this says what arrived.
function verifyFileBytes(file) {
  const declared = String(file.mimetype || '').toLowerCase();
  const expected = EXPECTED_FAMILIES[declared];
  if (!expected) return; // an image/* with no signature we know — accepted on trust

  const family = detectedFamily(file.buffer);
  if (family === 'unknown' || !expected.includes(family)) {
    throw rejectUpload(
      "That file's contents are not what its name says. Re-save it and try again — renaming a file does not change what is inside it."
    );
  }
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
    const declared = String(file.mimetype || '').toLowerCase();
    if (REJECTED_MIME_TYPES.includes(declared)) {
      return cb(
        rejectUpload('That file type is not supported for a photo. Use a JPG, PNG or HEIC image.')
      );
    }
    if (declared.startsWith('image/')) return cb(null, true);
    return cb(rejectUpload('That file is not an image. Upload a JPG, PNG or HEIC photo.'));
  },
});

// Wraps a configured multer instance so its own failure modes (file too large,
// rejected type) come back as clean JSON instead of falling through to the 500
// handler — and so the byte check above runs before any controller sees the file.
function singleField(instance, maxBytes, field) {
  return (req, res, next) => {
    instance.single(field)(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            message: `That file is too large. The limit is ${Math.round(maxBytes / (1024 * 1024))} MB.`,
          });
        }
        return res
          .status(err.status || 400)
          .json({ message: err.message || 'Could not read the uploaded file' });
      }
      if (!req.file) return next();
      try {
        verifyFileBytes(req.file);
        return next();
      } catch (checkErr) {
        return res
          .status(checkErr.status || 400)
          .json({ message: checkErr.message || 'Could not read the uploaded file' });
      }
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

module.exports = {
  uploadSingle,
  uploadImageSingle,
  MAX_FILE_BYTES,
  MAX_PHOTO_BYTES,
  // Exported for the test suite: the byte sniffing is the part worth pinning down.
  detectedFamily,
  verifyFileBytes,
  REJECTED_MIME_TYPES,
};
