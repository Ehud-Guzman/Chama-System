const ChamaDocument = require('../models/ChamaDocument');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { findActiveMemberByPhone, phoneGateError } = require('../utils/publicAccess');

const { DOCUMENT_CATEGORIES } = ChamaDocument;

// Everything a list/preview may carry. File bytes are deliberately absent — they
// only ever travel on a file endpoint.
const SUMMARY_FIELDS =
  'title category description visibleToMembers fileName mimeType size uploadedBy createdAt updatedAt';

function toSummary(doc) {
  return {
    id: doc._id,
    title: doc.title,
    category: doc.category,
    description: doc.description || '',
    visibleToMembers: doc.visibleToMembers !== false,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    size: doc.size,
    uploadedBy: doc.uploadedBy?.name || null,
    uploadedAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// Public shape — no admin metadata (who uploaded it), matching the rule the
// passbook follows.
function toPublic(doc) {
  return {
    id: doc._id,
    title: doc.title,
    category: doc.category,
    description: doc.description || '',
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    size: doc.size,
    uploadedAt: doc.createdAt,
  };
}

// A mongoose doc without the binary payload — safe to store in an audit entry
// (JSON-serialising a multi-MB Buffer would balloon the log).
function withoutData(doc) {
  const plain = doc.toObject ? doc.toObject() : { ...doc };
  delete plain.data;
  return plain;
}

// Content-Disposition has to be ASCII — a stray quote in a filename otherwise
// produces an invalid header.
function asciiFileName(name) {
  const safe = String(name || 'document')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');
  return safe || 'document';
}

function streamFile(res, doc, asAttachment) {
  res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', doc.data.length);
  res.setHeader(
    'Content-Disposition',
    `${asAttachment ? 'attachment' : 'inline'}; filename="${asciiFileName(doc.fileName)}"`
  );
  // Never let a shared device or a proxy cache a document unlocked by a phone number.
  res.setHeader('Cache-Control', 'no-store');
  res.end(doc.data);
}

// GET /api/documents?page=&limit= — ADMIN
async function listDocuments(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const [docs, total] = await Promise.all([
      ChamaDocument.find({ deleted: false })
        .select(SUMMARY_FIELDS)
        .populate('uploadedBy', 'name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ChamaDocument.countDocuments({ deleted: false }),
    ]);

    res.json({
      documents: docs.map(toSummary),
      categories: DOCUMENT_CATEGORIES,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/documents — ADMIN, multipart (field: `file`)
async function uploadDocument(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Choose a file to upload' });
    }

    const { title, category, description, visibleToMembers } = req.body || {};
    const cleanTitle = String(title || req.file.originalname || '').trim();
    if (!cleanTitle) {
      return res.status(400).json({ message: 'Give the document a title' });
    }

    const doc = await ChamaDocument.create({
      title: cleanTitle,
      category: DOCUMENT_CATEGORIES.includes(category) ? category : 'other',
      description: String(description || '').trim(),
      visibleToMembers: !(visibleToMembers === 'false' || visibleToMembers === false),
      fileName: String(req.file.originalname || 'document'),
      mimeType: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
      data: req.file.buffer,
      uploadedBy: req.user._id,
    });

    await logAudit({
      action: 'create',
      entityType: 'ChamaDocument',
      entityId: doc._id,
      performedBy: req.user._id,
      after: snapshot(withoutData(doc)),
    });

    res.status(201).json({
      document: toSummary({ ...doc.toObject(), uploadedBy: { name: req.user.name } }),
    });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/documents/:id — ADMIN, soft delete (the file is kept, so a
// mistaken deletion can still be recovered from the audit trail, exactly like
// members and contributions).
async function deleteDocument(req, res, next) {
  try {
    const doc = await ChamaDocument.findOne({ _id: req.params.id, deleted: false });
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    const before = snapshot(withoutData(doc));

    doc.deleted = true;
    await doc.save();

    await logAudit({
      action: 'delete',
      entityType: 'ChamaDocument',
      entityId: doc._id,
      performedBy: req.user._id,
      before,
      after: snapshot(withoutData(doc)),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// GET /api/documents/:id/file — ADMIN. `?download=1` forces a download instead
// of opening the file in the browser.
async function getDocumentFile(req, res, next) {
  try {
    const doc = await ChamaDocument.findOne({ _id: req.params.id, deleted: false }).select('+data');
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    streamFile(res, doc, req.query.download === '1');
  } catch (err) {
    next(err);
  }
}

// GET /api/public/documents?phone= — PUBLIC, phone-gated. Lists only documents
// the group published to members, and only for a registered active number.
async function publicListDocuments(req, res, next) {
  try {
    const member = await findActiveMemberByPhone(req.query.phone);
    if (!member) return phoneGateError(req, res);

    const docs = await ChamaDocument.find({ deleted: false, visibleToMembers: { $ne: false } })
      .select(SUMMARY_FIELDS)
      .sort({ createdAt: -1 })
      .lean();

    res.json({ documents: docs.map(toPublic), total: docs.length });
  } catch (err) {
    next(err);
  }
}

// GET /api/public/documents/:id/file?phone= — PUBLIC, phone-gated. `?download=1`
// forces a download; otherwise the file opens inline (a PDF or photo of a title
// deed is meant to be looked at, not saved to someone's Downloads folder).
async function publicDocumentFile(req, res, next) {
  try {
    const member = await findActiveMemberByPhone(req.query.phone);
    if (!member) return phoneGateError(req, res);

    const doc = await ChamaDocument.findOne({
      _id: req.params.id,
      deleted: false,
      visibleToMembers: { $ne: false },
    }).select('+data');
    if (!doc) return res.status(404).json({ message: 'not_found' });

    streamFile(res, doc, req.query.download === '1');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listDocuments,
  uploadDocument,
  deleteDocument,
  getDocumentFile,
  publicListDocuments,
  publicDocumentFile,
};