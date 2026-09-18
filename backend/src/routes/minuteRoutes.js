const router = require('express').Router();
const {
  listMinutes,
  getMinute,
  createMinute,
  updateMinute,
  deleteMinute,
} = require('../controllers/minuteController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// Every office role may read the minutes (the treasurer is asked to account for
// the money agreed in them), but writing them is the secretary's job — as are the
// documents and the constitution. This file used to carry no role guard at all,
// which let any signed-in member of staff edit or delete a minute through the API
// even though only some of them are shown the screen.
const canRead = requireRole('super_admin', 'admin', 'treasurer', 'secretary');
const canWrite = requireRole('super_admin', 'admin', 'secretary');

router.get('/', canRead, listMinutes);
router.get('/:id', canRead, getMinute);
router.post('/', canWrite, createMinute);
router.patch('/:id', canWrite, updateMinute);
router.delete('/:id', canWrite, deleteMinute);

module.exports = router;
