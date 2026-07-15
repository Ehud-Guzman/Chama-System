const { Schema, model } = require('mongoose');

// Generic named-sequence counter (currently just member registration
// numbers). Atomic $inc via findOneAndUpdate avoids both the race and the
// lexicographic-sort bug ("CM-10000" < "CM-9999" as a string) that come from
// deriving the next number by sorting existing records.
const CounterSchema = new Schema({
  name: { type: String, required: true, unique: true },
  value: { type: Number, required: true, default: 0 },
});

module.exports = model('Counter', CounterSchema);
