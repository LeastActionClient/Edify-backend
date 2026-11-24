import { Router } from 'express';
import {
  getCertificates,
  getNextSerial,
  createCertificate,
  deleteCertificate
} from '../controllers/bonafideCertificateController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/', getCertificates);
router.get('/next-serial', getNextSerial);
router.post('/', createCertificate);
router.delete('/:id', deleteCertificate);

export default router;
