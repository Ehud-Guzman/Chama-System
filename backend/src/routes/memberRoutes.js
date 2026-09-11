const router = require('express').Router();
const {
  listMembers,
  getMember,
  createMember,
  updateMember,
  deleteMember,
  resignMember,
  importMembers,
  importTemplate,
  exportMembers,
  memberStatement,
  memberStatementExcel,
} = require('../controllers/memberController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { setPledge } = require('../controllers/pledgeController');

router.use(requireAuth, requireRole('super_admin', 'admin'));

router.get('/', listMembers);
router.get('/export', exportMembers);
router.get('/import-template', importTemplate);
router.get('/:id', getMember);
router.get('/:id/statement/excel', memberStatementExcel);
router.get('/:id/statement', memberStatement);

router.post('/', createMember);
router.post('/import', importMembers);
router.patch('/:id', updateMember);
router.delete('/:id', deleteMember);
router.post('/:id/resign', resignMember);
router.put('/:memberId/pledges/:typeId', setPledge);

module.exports = router;
