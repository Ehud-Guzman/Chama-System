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

router.use(requireAuth, requireRole('super_admin', 'admin', 'treasurer'));

router.get('/', listContributions);
router.get('/bulk/template', bulkImportTemplate);
router.post('/', createContribution);
router.post('/bulk', bulkCreateContributions);
router.patch('/:id', updateContribution);
router.delete('/:id', deleteContribution);

module.exports = router;
