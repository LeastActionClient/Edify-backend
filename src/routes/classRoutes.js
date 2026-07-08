import { Router } from 'express';
import { getClasses, createClass, createSection } from '../controllers/classController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/', getClasses);
router.post('/', createClass);
router.post('/:classId/sections', createSection);

export default router;
