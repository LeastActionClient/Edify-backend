import { Router } from 'express';
import { 
  getFeeCategories, 
  createFeeCategory, 
  updateFeeCategory, 
  deleteFeeCategory, 
  assignFeeToStudent, 
  assignBulkFee,
  getCategoryStudentAssignments,
  assignCategoryToStudents,
  removeCategoryStudentAssignment,
  getRTEStudents,
  assignRTEStudentsFees,
  getStudentsForFeeAssignment,
  assignMultipleCategoriesToStudents
} from '../controllers/feeController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/categories', getFeeCategories);
router.post('/categories', createFeeCategory);
router.put('/categories/:id', updateFeeCategory);
router.delete('/categories/:id', deleteFeeCategory);

router.post('/assign-bulk', assignBulkFee);
router.post('/assign/:studentId', assignFeeToStudent);

router.get('/category-assignments/:categoryId', getCategoryStudentAssignments);
router.post('/assign-category-students', assignCategoryToStudents);
router.delete('/remove-student-assignment/:studentFeeId', removeCategoryStudentAssignment);

router.get('/rte-students', getRTEStudents);
router.post('/assign-rte-students', assignRTEStudentsFees);

router.get('/students-for-assignment', getStudentsForFeeAssignment);
router.post('/assign-multiple-categories-students', assignMultipleCategoriesToStudents);

export default router;
