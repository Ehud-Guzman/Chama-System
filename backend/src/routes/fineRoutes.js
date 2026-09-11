const router = require('express').Router();
const { listFines, createFine, settleFine, voidFine } = require('../controllers/fineController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', requireRole('super_admin', 'admin'), listFines);
router.post('/', requireRole('super_admin', 'admin', 'disciplinary'), createFine);
router.post('/:id/settle', requireRole('super_admin', 'admin'), settleFine);
router.delete('/:id', requireRole('super_admin', 'admin'), voidFine);

module.exports = router;
