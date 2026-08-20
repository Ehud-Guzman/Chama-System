// One-off DATABASE RESET script.
//
// Deletes every MongoDB collection EXCEPT:
//   - ContributionType
//   - Member
//   - FineType
//
// WARNING:
// This permanently deletes all data in every other collection.
// The three protected collections and ALL their documents are preserved.
//
// Usage:
//   node src/scripts/resetDatabase.js
//
// Windows PowerShell confirmation:
//   $env:CONFIRM_RESET="YES"; node src/scripts/resetDatabase.js

require('dotenv').config();

const mongoose = require('mongoose');

// Collections that MUST survive the reset.
// MongoDB collection names are normally lowercase/pluralized by Mongoose.
const PRESERVED_COLLECTIONS = new Set([
  'contributiontypes',
  'members',
  'finetypes',
]);

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const db = mongoose.connection.db;

  console.log('');
  console.log('Connected to MongoDB.');
  console.log(`Database: ${db.databaseName}`);
  console.log('');

  // Get every collection currently in the database.
  const collections = await db.listCollections().toArray();

  if (collections.length === 0) {
    console.log('Database is already empty.');
    await mongoose.disconnect();
    return;
  }

  console.log('Collections currently in database:');
  for (const collection of collections) {
    const protectedCollection = PRESERVED_COLLECTIONS.has(collection.name);

    console.log(
      `  ${protectedCollection ? '[KEEP]' : '[DELETE]'} ${collection.name}`
    );
  }

  const collectionsToDelete = collections.filter(
    (collection) => !PRESERVED_COLLECTIONS.has(collection.name)
  );

  const collectionsToPreserve = collections.filter(
    (collection) => PRESERVED_COLLECTIONS.has(collection.name)
  );

  console.log('');
  console.log(`Collections to preserve: ${collectionsToPreserve.length}`);
  console.log(`Collections to delete:   ${collectionsToDelete.length}`);
  console.log('');

  if (collectionsToDelete.length === 0) {
    console.log('Nothing needs to be deleted.');
    await mongoose.disconnect();
    return;
  }

  // Safety confirmation.
  if (process.env.CONFIRM_RESET !== 'YES') {
    console.log('========================================');
    console.log(' STOP: NO DATA WAS DELETED');
    console.log('========================================');
    console.log('');
    console.log('This operation will permanently DELETE:');

    for (const collection of collectionsToDelete) {
      console.log(`  - ${collection.name}`);
    }

    console.log('');
    console.log('The following collections will be PRESERVED:');

    for (const collection of collectionsToPreserve) {
      console.log(`  + ${collection.name}`);
    }

    console.log('');
    console.log('To confirm on Windows PowerShell, run:');
    console.log('');
    console.log('$env:CONFIRM_RESET="YES"; node src/scripts/resetDatabase.js');
    console.log('');
    console.log('========================================');

    await mongoose.disconnect();
    return;
  }

  console.log('Starting database reset...');
  console.log('');

  let deletedCount = 0;

  for (const collection of collectionsToDelete) {
    try {
      await db.dropCollection(collection.name);

      console.log(`Deleted collection: ${collection.name}`);
      deletedCount++;
    } catch (error) {
      // NamespaceNotFound means the collection disappeared between
      // listCollections() and dropCollection(). Treat it as harmless.
      if (error.codeName === 'NamespaceNotFound') {
        console.log(`Already gone: ${collection.name}`);
        continue;
      }

      throw error;
    }
  }

  console.log('');
  console.log('========================================');
  console.log(' DATABASE RESET COMPLETE');
  console.log('========================================');
  console.log(`Deleted collections: ${deletedCount}`);
  console.log('');
  console.log('PRESERVED:');

  for (const collection of collectionsToPreserve) {
    console.log(`  + ${collection.name}`);
  }

  console.log('');
  console.log('Deleted everything else.');
  console.log('========================================');
  console.log('');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('');
  console.error('========================================');
  console.error(' DATABASE RESET FAILED');
  console.error('========================================');
  console.error(err);
  console.error('');

  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});