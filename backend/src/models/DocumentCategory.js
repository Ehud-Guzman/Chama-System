const { Schema, model } = require('mongoose');

// The headings the document vault files its papers under — title deeds,
// certificates, and whatever else the group keeps.
//
// Seeded with the group's original six (see utils/documentCategories.js) and then
// maintained by an admin from the documents screen: no fixed enum can anticipate
// the water-project agreement or the land-search receipt that turns up next.
const DocumentCategorySchema = new Schema(
  {
    // Stable slug the documents store. Never shown to a person — the label is.
    value: { type: String, required: true, unique: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    // Seeded rows came with the system. The fallback ('other') is one of them and
    // is never removable: a document has to land somewhere.
    seeded: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = model('DocumentCategory', DocumentCategorySchema);
