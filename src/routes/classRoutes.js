import { Router } from 'express';
import { getClasses, createClass, createSection, deleteClass, deleteSection } from '../controllers/classController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/', getClasses);
router.post('/', createClass);
router.post('/:classId/sections', createSection);
router.delete('/:classId', deleteClass);
router.delete('/:classId/sections/:sectionId', deleteSection);

export default router;
