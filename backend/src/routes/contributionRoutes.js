const router = require('express').Router();
const {
  listContributions,
  createContribution,
  bulkCreateContributions,
  bulkImportTemplate,
  updateContribution,
  deleteContribution,
} = require('../controllers/contributionController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { periodLock } = require('../middleware/periodLock');

router.use(requireAuth, requireRole('super_admin', 'admin', 'treasurer'));

router.get('/', listContributions);
router.get('/bulk/template', bulkImportTemplate);
// Money in a closed period is the super admin's alone (middleware/periodLock).
router.post('/', periodLock('body'), createContribution);
router.post('/bulk', periodLock('body'), bulkCreateContributions);
router.patch('/:id', periodLock('contribution'), updateContribution);
router.delete('/:id', periodLock('contribution'), deleteContribution);

module.exports = router;
