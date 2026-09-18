const { Schema, model } = require('mongoose');

// The group's constitution, as a document in the database rather than a file in the
// source tree.
//
// The text used to live in src/data/constitution.js, which meant the document the
// API carefully gates behind a member's ID was sitting in a repository anybody
// could read. The file is still the seed (so a fresh install works), but this row
// wins when it exists — see utils/constitutionData.js and
// `npm run seed:constitution`.
//
// One row, like Settings: there is one constitution.
const ConstitutionTextSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'main' },
    // Shape is the same as the data file's exports: the cover block, then the
    // chapters with their clauses. Mixed because it is a document body — it is
    // never queried by its parts, only read whole.
    meta: { type: Schema.Types.Mixed, required: true },
    chapters: { type: Schema.Types.Array, required: true },
    edition: { type: String, default: '' },
    seededAt: { type: Date, default: Date.now },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = model('ConstitutionText', ConstitutionTextSchema);
