const router = require('express').Router();
const { listFineTypes, createFineType, updateFineType } = require('../controllers/fineTypeController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('super_admin', 'admin'));

router.get('/', listFineTypes);
router.post('/', createFineType);
router.patch('/:id', updateFineType);

module.exports = router;
