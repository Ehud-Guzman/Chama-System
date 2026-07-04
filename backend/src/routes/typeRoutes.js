const router = require('express').Router();
const { listTypes, createType, updateType } = require('../controllers/typeController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', listTypes);
router.post('/', createType);
router.patch('/:id', updateType);

module.exports = router;
