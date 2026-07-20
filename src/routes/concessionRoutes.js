import { Router } from 'express';
import {
  getStudentFeesWithConcessions,
  createConcession,
  updateConcession,
  deleteConcession,
  getStudentNetFees,
  getConcessionHistory,
  toggleConcessionStatus
} from '../controllers/concessionController.js';
import { authenticate, authorizeSuperAdmin } from '../middlewares/authMiddleware.js';

const router = Router();

// All concession routes require authentication
router.use(authenticate);

// Read-only endpoints (accessible by both Admin and Super Admin)
router.get('/student-fees', getStudentFeesWithConcessions);
router.get('/history', getConcessionHistory);
router.get('/net-fee/:studentId', getStudentNetFees);

// Write/Delete endpoints (accessible ONLY by Super Admin)
router.post('/', authorizeSuperAdmin, createConcession);
router.put('/:id', authorizeSuperAdmin, updateConcession);
router.patch('/:id/status', authorizeSuperAdmin, toggleConcessionStatus);
router.delete('/:id', authorizeSuperAdmin, deleteConcession);

export default router;
