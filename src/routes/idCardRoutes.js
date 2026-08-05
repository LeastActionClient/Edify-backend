import { Router } from 'express';
import { getIdCards, getIdCardByStudentId, generateIdCards, downloadIdCards } from '../controllers/idCardController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/', getIdCards);
router.get('/:studentId', getIdCardByStudentId);
router.post('/generate', generateIdCards);
router.post('/download', downloadIdCards);

export default router;
