const router = require('express').Router();
const {
  listMembers,
  getMember,
  createMember,
  updateMember,
  deleteMember,
  importMembers,
  exportMembers,
} = require('../controllers/memberController');
const { requireAuth } = require('../middleware/auth');
const { setPledge } = require('../controllers/pledgeController');

router.use(requireAuth);

router.get('/', listMembers);
router.post('/', createMember);
router.post('/import', importMembers);
router.get('/export', exportMembers);
router.get('/:id', getMember);
router.patch('/:id', updateMember);
router.delete('/:id', deleteMember);
router.put('/:memberId/pledges/:typeId', setPledge);

module.exports = router;
