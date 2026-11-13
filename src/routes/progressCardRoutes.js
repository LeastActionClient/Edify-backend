import { Router } from 'express';
import {
  getSubjects,
  createOrSelectSubjects,
  updateSubject,
  deleteSubject,
  getExams,
  createExam,
  updateExam,
  deleteExam,
  getProgressCards,
  getStudentProgressCard,
  saveProgressCard,
  saveSubjectGradesForStudents
} from '../controllers/progressCardController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

// Centralized Subject Management
router.get('/subjects', getSubjects);
router.post('/subjects', createOrSelectSubjects);
router.put('/subjects/:subjectId', updateSubject);
router.delete('/subjects/:subjectId', deleteSubject);

// Dynamic Exam Name Management
router.get('/exams', getExams);
router.post('/exams', authorize('SUPER_ADMIN', 'ADMIN'), createExam);
router.put('/exams/:examId', authorize('SUPER_ADMIN', 'ADMIN'), updateExam);
router.delete('/exams/:examId', authorize('SUPER_ADMIN', 'ADMIN'), deleteExam);

// Subject-wise Marks / Grade Entry
router.post('/bulk-subject-save', saveSubjectGradesForStudents);

// Student Progress Cards
router.get('/', getProgressCards);
router.post('/save', saveProgressCard);
router.get('/:studentId', getStudentProgressCard);

export default router;
