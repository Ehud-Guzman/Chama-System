const ChamaDocument = require('../models/ChamaDocument');
const DocumentCategory = require('../models/DocumentCategory');
const { logAudit, snapshot } = require('../utils/auditLogger');
const { findActiveMemberByNationalId } = require('../utils/publicAccess');
const {
  FALLBACK_CATEGORY,
  slugifyCategory,
  listDocumentCategories,
  categoryExists,
} = require('../utils/documentCategories');

// Everything a list/preview may carry. File bytes are deliberately absent — they
// only ever travel on a file endpoint.
const SUMMARY_FIELDS =
  'title category categoryLabel description visibleToMembers fileName mimeType size uploadedBy createdAt updatedAt';

function toSummary(doc) {
  return {
    id: doc._id,
    title: doc.title,
    category: doc.category,
    categoryLabel: doc.categoryLabel || '',
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
    categoryLabel: doc.categoryLabel || '',
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

    const [docs, total, categories] = await Promise.all([
      ChamaDocument.find({ deleted: false })
        .select(SUMMARY_FIELDS)
        .populate('uploadedBy', 'name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ChamaDocument.countDocuments({ deleted: false }),
      listDocumentCategories(),
    ]);

    res.json({
      documents: docs.map(toSummary),
      categories,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/documents/categories — the headings a document may be filed under.
// Every role that can read the vault can read the list; only managers change it.
async function listCategories(req, res, next) {
  try {
    res.json({ categories: await listDocumentCategories() });
  } catch (err) {
    next(err);
  }
}

// POST /api/documents/categories — ADMIN/SECRETARY. { label }
async function createCategory(req, res, next) {
  try {
    const label = String(req.body?.label || '').trim().replace(/\s+/g, ' ');
    if (label.length < 2) {
      return res.status(400).json({ message: 'Give the category a name' });
    }
    if (label.length > 40) {
      return res.status(400).json({ message: 'Keep the category name under 40 characters' });
    }

    const value = slugifyCategory(label);
    if (!value) {
      return res.status(400).json({ message: 'Use letters or numbers in the category name' });
    }

    // A category that was removed earlier is brought back rather than duplicated
    // — documents filed under its slug then read correctly again.
    const existing = await DocumentCategory.findOne({ value });
    if (existing && !existing.deleted) {
      return res.status(409).json({ message: `"${existing.label}" is already a category` });
    }

    const category = existing
      ? await DocumentCategory.findByIdAndUpdate(
          existing._id,
          { label, deleted: false, createdBy: req.user._id },
          { new: true }
        )
      : await DocumentCategory.create({ value, label, createdBy: req.user._id });

    await logAudit({
      action: existing ? 'update' : 'create',
      entityType: 'DocumentCategory',
      entityId: category._id,
      performedBy: req.user._id,
      after: snapshot(category),
    });

    res.status(201).json({
      category: {
        value: category.value,
        label: category.label,
        seeded: Boolean(category.seeded),
        builtIn: category.value === FALLBACK_CATEGORY,
      },
      categories: await listDocumentCategories(),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'That category already exists' });
    }
    next(err);
  }
}

// DELETE /api/documents/categories/:id — ADMIN/SECRETARY, soft delete. Documents
// already filed under it keep their own label snapshot, so removing a heading
// never renames a filing that happened.
async function deleteCategory(req, res, next) {
  try {
    const category = await DocumentCategory.findOne({ _id: req.params.id, deleted: false });
    if (!category) return res.status(404).json({ message: 'Category not found' });
    if (category.value === FALLBACK_CATEGORY) {
      return res
        .status(400)
        .json({ message: 'This is the fallback category — every document can fall back to it' });
    }

    const before = snapshot(category);
    category.deleted = true;
    await category.save();

    await logAudit({
      action: 'delete',
      entityType: 'DocumentCategory',
      entityId: category._id,
      performedBy: req.user._id,
      before,
      after: snapshot(category),
    });

    res.json({ ok: true, categories: await listDocumentCategories() });
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

    // Checked against the group's own list rather than trusted from the browser:
    // an unknown heading is filed under the fallback instead of inventing a
    // category nobody can find again.
    const wanted = String(category || '').trim().toLowerCase();
    const known = await categoryExists(wanted);
    const categories = await listDocumentCategories();
    const chosen = categories.find((c) => c.value === (known ? wanted : FALLBACK_CATEGORY));

    const doc = await ChamaDocument.create({
      title: cleanTitle,
      category: chosen ? chosen.value : FALLBACK_CATEGORY,
      categoryLabel: chosen ? chosen.label : 'Other',
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

// GET /api/public/documents?nationalId= — PUBLIC, ID-gated. Lists only documents
// the group published to members, and only for an ID on an active member.
async function publicListDocuments(req, res, next) {
  try {
    const gate = await findActiveMemberByNationalId(req.query.nationalId);
    if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });

    const [docs, categories] = await Promise.all([
      ChamaDocument.find({ deleted: false, visibleToMembers: { $ne: false } })
        .select(SUMMARY_FIELDS)
        .sort({ createdAt: -1 })
        .lean(),
      listDocumentCategories(),
    ]);

    res.json({
      documents: docs.map(toPublic),
      // Only what a label needs — the members' page files nothing, so it has no
      // use for who created a category or when.
      categories: categories.map((c) => ({ value: c.value, label: c.label })),
      total: docs.length,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/public/documents/:id/file?nationalId= — PUBLIC, ID-gated. `?download=1`
// forces a download; otherwise the file opens inline (a PDF or photo of a title
// deed is meant to be looked at, not saved to someone's Downloads folder).
async function publicDocumentFile(req, res, next) {
  try {
    const gate = await findActiveMemberByNationalId(req.query.nationalId);
    if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });

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
  listCategories,
  createCategory,
  deleteCategory,
  uploadDocument,
  deleteDocument,
  getDocumentFile,
  publicListDocuments,
  publicDocumentFile,
};