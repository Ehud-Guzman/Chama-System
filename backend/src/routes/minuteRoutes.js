const router = require('express').Router();
const {
  listMinutes,
  getMinute,
  createMinute,
  updateMinute,
  deleteMinute,
} = require('../controllers/minuteController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', listMinutes);
router.post('/', createMinute);
router.get('/:id', getMinute);
router.patch('/:id', updateMinute);
router.delete('/:id', deleteMinute);

module.exports = router;
