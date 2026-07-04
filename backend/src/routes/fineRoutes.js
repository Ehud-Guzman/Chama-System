const router = require('express').Router();
const { listFines, createFine, settleFine, voidFine } = require('../controllers/fineController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', listFines);
router.post('/', createFine);
router.post('/:id/settle', settleFine);
router.delete('/:id', voidFine);

module.exports = router;
