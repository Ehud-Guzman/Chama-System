const router = require('express').Router();
const multer = require('multer');
const { requireAuth, requireRole } = require('../middleware/auth');
const { overview, verifyAuditChainNow, permissions } = require('../controllers/controlRoomController');
const {
  listAccounts,
  signOutAccount,
  signOutEveryone,
  freezeAccount,
  unfreezeAccount,
  changeRole,
  startPreview,
} = require('../controllers/accountControlController');
const {
  offsiteList,
  offsiteDownload,
  setMaintenance,
  setLock,
  setSwitches,
  setJobPaused,
  jobHistory,
  auditEntry,
  reviewEntry,
  flaggedEntries,
  exportAuditFull,
} = require('../controllers/groupControlController');
const {
  maxUploadBytes,
  inspectBackup,
  applyBackup,
  resetPreview,
  resetMoney,
} = require('../controllers/dataRecoveryController');
const { previewMerge, mergeMembers, reinstateMember } = require('../controllers/memberMergeController');

// The Control Room. Everything under here is the super admin's alone: it is mounted behind both
// requireAuth and requireRole('super_admin'), so a new route added to this file is protected
// before it is written. (A preview session — the super admin looking as another role — carries
// that role, so it cannot reach any of this either, which is the point of previewing.)
router.use(requireAuth, requireRole('super_admin'));

// A restore file is held in memory just long enough to be written to a temporary file. The limit is
// generous (a backup carrying scanned documents is large) but not unlimited.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadBytes(), files: 1 } });
function backupUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        message: `That file is bigger than ${Math.round(maxUploadBytes() / 1024 / 1024)} MB, the most this screen will take. Restore it from the command line instead.`,
      });
    }
    return next(err);
  });
}

// --- the first screen --------------------------------------------------------------------------
router.get('/overview', overview);
router.post('/audit-chain/verify', verifyAuditChainNow);
router.get('/permissions', permissions);

// --- accounts and sessions ---------------------------------------------------------------------
router.get('/accounts', listAccounts);
router.post('/accounts/sign-out-all', signOutEveryone);
router.post('/accounts/:id/sign-out', signOutAccount);
router.post('/accounts/:id/freeze', freezeAccount);
router.post('/accounts/:id/unfreeze', unfreezeAccount);
router.patch('/accounts/:id/role', changeRole);
router.post('/preview', startPreview);

// --- group-wide levers -------------------------------------------------------------------------
router.put('/maintenance', setMaintenance);
router.put('/lock', setLock);
router.put('/switches', setSwitches);
router.put('/jobs/:name', setJobPaused);
router.get('/jobs/history', jobHistory);

// --- audit powers ------------------------------------------------------------------------------
router.get('/audit-reviews', flaggedEntries);
router.get('/audit/:id', auditEntry);
router.post('/audit/:id/review', reviewEntry);
router.get('/export/audit', exportAuditFull);

// --- data and recovery -------------------------------------------------------------------------
router.get('/offsite', offsiteList);
router.get('/offsite/download', offsiteDownload);
router.post('/restore/inspect', backupUpload, inspectBackup);
router.post('/restore/apply', applyBackup);
router.get('/danger/preview', resetPreview);
router.post('/danger/reset-money', resetMoney);

// --- overrides ---------------------------------------------------------------------------------
router.post('/members/merge/preview', previewMerge);
router.post('/members/merge', mergeMembers);
router.post('/members/:id/reinstate', reinstateMember);

module.exports = router;
