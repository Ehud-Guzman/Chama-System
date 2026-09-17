const router = require('express').Router();
const {
  listDocuments,
  uploadDocument,
  deleteDocument,
  getDocumentFile,
} = require('../controllers/documentController');
const { uploadSingle } = require('../middleware/uploadDocument');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// Reading the vault is open to every role that touches records; changing it is
// not (treasurer and disciplinary can look, not upload or delete).
router.get('/', requireRole('super_admin', 'admin', 'treasurer', 'secretary'), listDocuments);
router.get(
  '/:id/file',
  requireRole('super_admin', 'admin', 'treasurer', 'secretary'),
  getDocumentFile
);

router.use(requireRole('super_admin', 'admin', 'secretary'));
router.post('/', uploadSingle('file'), uploadDocument);
router.delete('/:id', deleteDocument);

module.exports = router;
