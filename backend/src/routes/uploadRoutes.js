const router = require('express').Router();
const { uploadPhoto, uploadStatus, removePhoto } = require('../controllers/uploadController');
const { uploadImageSingle } = require('../middleware/uploadDocument');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// Same roles that may create/edit members — a photo is just another member field.
router.use(requireRole('super_admin', 'admin', 'treasurer'));

router.get('/status', uploadStatus);
router.post('/member-photo', uploadImageSingle('file'), uploadPhoto);
router.post('/member-photo/remove', removePhoto);

module.exports = router;