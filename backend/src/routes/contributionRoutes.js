const router = require('express').Router();
const {
  listContributions,
  createContribution,
  bulkCreateContributions,
  updateContribution,
  deleteContribution,
} = require('../controllers/contributionController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('super_admin', 'admin'));

router.get('/', listContributions);
router.post('/', createContribution);
router.post('/bulk', bulkCreateContributions);
router.patch('/:id', updateContribution);
router.delete('/:id', deleteContribution);

module.exports = router;
