import { Router } from 'express';
import { getAcademicYears, getActiveAcademicYear, createAcademicYear, updateAcademicYearStatus, getStudentAcademicHistory } from '../controllers/academicYearController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'ADMIN'));

router.get('/', getAcademicYears);
router.get('/active', getActiveAcademicYear);
router.post('/', createAcademicYear);
router.put('/:id/status', updateAcademicYearStatus);
router.get('/students/:studentId/history', getStudentAcademicHistory);

export default router;
