const mongoose = require('mongoose');
const { MemoryStore } = require('express-rate-limit');

// A rate-limit store that lives in the database, so the limits mean something.
//
// The default store keeps its counts in the process's memory. That is fine for a limit that is only
// there to stop a runaway client, and wrong for the ones that stand between a stranger and a
// password or a member's passbook: every deploy and every restart wiped the count, so five wrong
// passwords could be followed by five more the moment the host recycled the process, and two copies
// of the server each held half the count.
//
// This keeps one small document per key, `{ _id: key, hits, resetAt }`, and a TTL index removes it
// when its window is over. An increment is a single atomic update, so two requests landing together
// are both counted.
//
// **It fails open, on purpose.** A limiter that throws when the database is slow would turn a
// database blip into a login outage for the whole committee. When the database cannot be reached
// the count falls back to the process's own memory for that request, which is exactly what the
// limiter did before this existed: the protection gets weaker for a moment, the app does not stop.
//
// Used for the limits that guard credentials (sign-in, the second factor, the members' passbook,
// password changes and resets). Not for the general API ceiling: that one sees hundreds of requests
// a minute and does not need to survive a restart.
const COLLECTION = 'ratelimits';

let indexReady = false;

function collection() {
  return mongoose.connection.collection(COLLECTION);
}

async function ensureIndex() {
  if (indexReady) return;
  indexReady = true;
  try {
    // `expireAfterSeconds: 0` removes a document the moment its own `resetAt` has passed.
    await collection().createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 });
  } catch {
    // Not fatal: the window check below ignores an expired document anyway. The index only keeps
    // the collection small.
    indexReady = false;
  }
}

class DatabaseStore {
  // `prefix` keeps one limiter's keys apart from another's, because several limiters share the
  // collection and the same address would otherwise count against all of them at once.
  constructor({ prefix, getCollection = collection, isConnected } = {}) {
    this.prefix = prefix || 'limit';
    this.getCollection = getCollection;
    this.isConnected = isConnected || (() => mongoose.connection.readyState === 1);
    this.fallback = new MemoryStore();
    this.windowMs = 60 * 1000;
  }

  init(options) {
    this.windowMs = options.windowMs;
    this.fallback.init(options);
  }

  keyFor(key) {
    return `${this.prefix}:${key}`;
  }

  async increment(key) {
    if (!this.isConnected()) return this.fallback.increment(key);
    try {
      ensureIndex();
      const _id = this.keyFor(key);
      const now = new Date();
      const resetAt = new Date(now.getTime() + this.windowMs);

      // One atomic update does all of it: inside a live window it adds one, otherwise it starts a
      // new window at one. Doing it in two steps (look, then write) lost counts when a burst of
      // requests arrived on a key with no window yet — each one started the window afresh and the
      // last write won — which is exactly the traffic an attacker sends.
      const update = [
        {
          $set: {
            hits: { $cond: [{ $gt: ['$resetAt', now] }, { $add: ['$hits', 1] }, 1] },
            resetAt: { $cond: [{ $gt: ['$resetAt', now] }, '$resetAt', resetAt] },
          },
        },
      ];
      const options = { upsert: true, returnDocument: 'after' };

      let doc;
      try {
        doc = await this.getCollection().findOneAndUpdate({ _id }, update, options);
      } catch (err) {
        // Two requests creating the very first document at once: one wins the insert and the other
        // is told the key exists. The document is there now, so the same update counts it.
        if (err && err.code === 11000) {
          doc = await this.getCollection().findOneAndUpdate({ _id }, update, options);
        } else {
          throw err;
        }
      }
      return { totalHits: doc.hits, resetTime: doc.resetAt };
    } catch {
      return this.fallback.increment(key);
    }
  }

  async decrement(key) {
    if (!this.isConnected()) return this.fallback.decrement(key);
    try {
      await this.getCollection().updateOne(
        { _id: this.keyFor(key), resetAt: { $gt: new Date() }, hits: { $gt: 0 } },
        { $inc: { hits: -1 } }
      );
    } catch {
      this.fallback.decrement(key);
    }
    return undefined;
  }

  async resetKey(key) {
    this.fallback.resetKey(key);
    if (!this.isConnected()) return;
    try {
      await this.getCollection().deleteOne({ _id: this.keyFor(key) });
    } catch {
      // Nothing to clean up that the TTL index will not.
    }
  }
}

module.exports = { DatabaseStore };
