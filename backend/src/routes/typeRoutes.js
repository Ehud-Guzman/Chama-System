const router = require('express').Router();
const { listTypes, createType, updateType } = require('../controllers/typeController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('super_admin', 'admin', 'treasurer'));

router.get('/', listTypes);
router.post('/', createType);
router.patch('/:id', updateType);

module.exports = router;
