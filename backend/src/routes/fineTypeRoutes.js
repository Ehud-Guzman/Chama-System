const router = require('express').Router();
const { listFineTypes, createFineType, updateFineType } = require('../controllers/fineTypeController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', requireRole('super_admin', 'admin', 'disciplinary'), listFineTypes);
router.post('/', requireRole('super_admin', 'admin'), createFineType);
router.patch('/:id', requireRole('super_admin', 'admin'), updateFineType);

module.exports = router;
