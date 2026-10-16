const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { isCloudinaryConfigured, cloudinaryClient } = require('./cloudinary');

// A copy of the books that does not live on the server.
//
// On a host with a temporary disk (Render's free instances) every backup the nightly job writes is
// erased by the next deploy or restart, so the files on the host are not a backup: they are a cache
// of one. The group already has Cloudinary for photos, and it is a place the host cannot wipe, so each
// backup is also gzipped (the JSON shrinks to a tenth of its size, which is what keeps it under
// Cloudinary's free-plan file limit) and uploaded there as a *private* file: not listed, not
// reachable by URL, and downloadable only through this API by the super admin.
//
// Nothing here can fail the backup itself. The local file is written first; this is the step after,
// and it reports its own outcome in the job record.
//
//   BACKUP_OFFSITE=off            switches it off (on by default whenever Cloudinary is set up)
//   CLOUDINARY_BACKUP_FOLDER      where, default chama-system/backups
//   OFFSITE_BACKUP_MAX_MB         the largest file it will try to upload, default 10 (the free plan's limit)
//   OFFSITE_BACKUP_RETENTION      how many copies to keep there, default 14
const DEFAULT_FOLDER = 'chama-system/backups';
const OFF = new Set(['off', 'false', 'no', '0', 'disabled']);

let testClient = null;
// For the test suite, which has no Cloudinary account to talk to.
function setClientForTests(client) {
  testClient = client;
}

const client = () => testClient || cloudinaryClient();
const folder = () => (process.env.CLOUDINARY_BACKUP_FOLDER || DEFAULT_FOLDER).replace(/^\/+|\/+$/g, '');
const maxBytes = () => (Number(process.env.OFFSITE_BACKUP_MAX_MB) > 0 ? Number(process.env.OFFSITE_BACKUP_MAX_MB) : 10) * 1024 * 1024;
const retention = () =>
  Number.isFinite(Number(process.env.OFFSITE_BACKUP_RETENTION)) && Number(process.env.OFFSITE_BACKUP_RETENTION) > 0
    ? Math.floor(Number(process.env.OFFSITE_BACKUP_RETENTION))
    : 14;

function offsiteEnabled() {
  // A test run never talks to a real account, whatever the machine's .env holds: only a stand-in
  // client put there by the test itself counts.
  if (process.env.NODE_ENV === 'test' && !testClient) return false;
  if (OFF.has(String(process.env.BACKUP_OFFSITE ?? '').trim().toLowerCase())) return false;
  return Boolean(testClient) || isCloudinaryConfigured();
}

const RESOURCE = { resource_type: 'raw', type: 'authenticated' };

// Gzips `filePath` to a temporary file and uploads it. Resolves with what happened — never throws.
async function uploadBackupOffsite(filePath, fileName) {
  if (!offsiteEnabled()) {
    return { ok: false, skipped: true, error: 'Off-server copies are not set up (Cloudinary is not configured).' };
  }
  const gz = path.join(os.tmpdir(), `${fileName}.gz`);
  try {
    await pipeline(fs.createReadStream(filePath), zlib.createGzip({ level: 9 }), fs.createWriteStream(gz));
    const bytes = fs.statSync(gz).size;
    if (bytes > maxBytes()) {
      return {
        ok: false,
        error: `The compressed backup is ${(bytes / 1024 / 1024).toFixed(1)} MB, over the ${(maxBytes() / 1024 / 1024).toFixed(0)} MB this upload allows. Download a copy by hand, or raise OFFSITE_BACKUP_MAX_MB if the Cloudinary plan allows it.`,
      };
    }
    const publicId = `${folder()}/${fileName}.gz`;
    await client().uploader.upload(gz, { ...RESOURCE, public_id: publicId, overwrite: false, use_filename: false });
    return { ok: true, publicId, sizeMb: Number((bytes / 1024 / 1024).toFixed(2)) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err?.error?.message || err).slice(0, 300) };
  } finally {
    fs.rm(gz, { force: true }, () => {});
  }
}

// What is kept there, newest first.
async function listOffsite() {
  const result = await client().api.resources({ ...RESOURCE, prefix: `${folder()}/`, max_results: 200 });
  return (result.resources || [])
    .map((r) => ({
      id: r.public_id,
      name: String(r.public_id).split('/').pop(),
      sizeMb: Number(((r.bytes || 0) / 1024 / 1024).toFixed(2)),
      at: r.created_at,
    }))
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

// Keeps the newest `keep`, removes the rest. Never throws.
async function pruneOffsite(keep = retention()) {
  try {
    const all = await listOffsite();
    const doomed = all.slice(keep).map((r) => r.id);
    if (doomed.length) await client().api.delete_resources(doomed, RESOURCE);
    return doomed;
  } catch {
    return [];
  }
}

// A short-lived signed address for one stored copy, for the server to fetch from. It never leaves
// the server: the super admin is handed the file through the API, not this link. (The ordinary signed
// delivery address is refused for private raw files by the storage; the API's own download address,
// signed with the account's key, is the one that works — checked against the real service.)
function signedUrlFor(publicId) {
  return client().utils.private_download_url(publicId, '', {
    ...RESOURCE,
    expires_at: Math.floor(Date.now() / 1000) + 300,
  });
}

// Only things that are ours: the id must sit inside the backups folder.
function isOurs(publicId) {
  return typeof publicId === 'string' && publicId.startsWith(`${folder()}/`) && !publicId.includes('..');
}

module.exports = {
  offsiteEnabled,
  uploadBackupOffsite,
  listOffsite,
  pruneOffsite,
  signedUrlFor,
  isOurs,
  setClientForTests,
  retention,
};
