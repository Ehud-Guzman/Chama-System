const FineType = require('../models/FineType');

// The fixed set of disciplinary infractions the disciplinary role issues
// fines for. Seeded idempotently on server start so the role works out of
// the box — amounts default to 0 until an admin sets them via Fine types.
const DISCIPLINARY_TYPES = [
  'Phone Disturbance',
  'Lateness',
  'Absent with apology',
  'Absent without apology',
  'Disturbance (while in a meeting)',
];

async function seedDisciplinaryFineTypes() {
  for (const name of DISCIPLINARY_TYPES) {
    await FineType.updateOne(
      { name },
      { $setOnInsert: { name, category: 'disciplinary', defaultAmount: 0, active: true } },
      { upsert: true }
    );
  }
}

module.exports = { seedDisciplinaryFineTypes, DISCIPLINARY_TYPES };
