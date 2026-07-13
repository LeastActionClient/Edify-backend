import { Router } from 'express';
import { getClasses, createClass, updateClass, deleteClass, createSection, updateSection, deleteSection } from '../controllers/classController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/', getClasses);
router.post('/', createClass);
router.put('/:id', updateClass);
router.delete('/:id', deleteClass);
router.post('/:classId/sections', createSection);
router.put('/:classId/sections/:sectionId', updateSection);
router.delete('/:classId/sections/:sectionId', deleteSection);

export default router;
