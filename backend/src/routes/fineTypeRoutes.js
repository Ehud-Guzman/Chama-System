const router = require('express').Router();
const { listFineTypes, createFineType, updateFineType } = require('../controllers/fineTypeController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', listFineTypes);
router.post('/', createFineType);
router.patch('/:id', updateFineType);

module.exports = router;
