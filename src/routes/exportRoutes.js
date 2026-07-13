import { Router } from 'express';
import { exportStudents } from '../controllers/exportController.js';
import { authenticate as protect, authorize } from '../middlewares/authMiddleware.js';

const router = Router();

// Only SUPER_ADMIN and ADMIN can export
router.post('/students', protect, authorize('SUPER_ADMIN', 'ADMIN'), exportStudents);

export default router;
