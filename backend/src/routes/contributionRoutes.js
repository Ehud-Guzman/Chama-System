const router = require('express').Router();
const {
  listContributions,
  createContribution,
  bulkCreateContributions,
  updateContribution,
  deleteContribution,
} = require('../controllers/contributionController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', listContributions);
router.post('/', createContribution);
router.post('/bulk', bulkCreateContributions);
router.patch('/:id', updateContribution);
router.delete('/:id', deleteContribution);

module.exports = router;
