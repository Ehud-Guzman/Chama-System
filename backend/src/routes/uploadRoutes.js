const router = require('express').Router();
const { uploadPhoto, uploadLogo, uploadStatus, removePhoto } = require('../controllers/uploadController');
const { uploadImageSingle } = require('../middleware/uploadDocument');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// Same roles that may create/edit members — a photo is just another member field.
router.use(requireRole('super_admin', 'admin', 'treasurer'));

router.get('/status', uploadStatus);
router.post('/member-photo', uploadImageSingle('file'), uploadPhoto);
router.post('/member-photo/remove', removePhoto);

// The logo is a settings field rather than a member field, so it follows the
// settings routes' own role set — the treasurer keeps the members' pictures, but
// the group's identity stays with the admins who may edit Settings.
router.post('/chama-logo', requireRole('super_admin', 'admin'), uploadImageSingle('file'), uploadLogo);

module.exports = router;