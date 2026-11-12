import { Router } from 'express';
import {
  getProgressCards,
  getStudentProgressCard,
  saveProgressCard
} from '../controllers/progressCardController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/', getProgressCards);
router.get('/:studentId', getStudentProgressCard);
router.post('/save', saveProgressCard);

export default router;
