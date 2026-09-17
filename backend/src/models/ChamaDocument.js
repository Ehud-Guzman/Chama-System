const { Schema, model } = require('mongoose');

// Group-level documents (title deeds, certificates, registration papers, ...).
// The bytes are stored in the database rather than on disk: the API runs on
// hosts with an ephemeral filesystem, so a file written to disk would disappear
// on the next deploy (and would not survive a backup/restore either).
const DOCUMENT_CATEGORIES = [
  'title_deed',
  'certificate',
  'registration',
  'constitution',
  'financial',
  'other',
];

const ChamaDocumentSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: DOCUMENT_CATEGORIES, default: 'other' },
    description: { type: String, default: '' },
    // Every document is published to members by default — that is the whole
    // point of the vault — but an admin can withhold one from the public list.
    visibleToMembers: { type: Boolean, default: true },
    fileName: { type: String, required: true, trim: true },
    mimeType: { type: String, default: 'application/octet-stream' },
    size: { type: Number, default: 0 },
    // Excluded from normal queries — only the file endpoint loads it, so a
    // list of documents never drags megabytes of file bytes with it.
    data: { type: Buffer, required: true, select: false },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const ChamaDocument = model('ChamaDocument', ChamaDocumentSchema);

module.exports = ChamaDocument;
module.exports.DOCUMENT_CATEGORIES = DOCUMENT_CATEGORIES;
