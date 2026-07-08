import { Router } from 'express';
import { createApplication, getApplications, approveApplication, getNextNumbers, toggleFeeStatus, deleteApplication } from '../controllers/applicationController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/next-numbers', getNextNumbers);
router.post('/', createApplication);
router.get('/', getApplications);
router.put('/:id/approve', approveApplication);
router.put('/:id/fee-status', toggleFeeStatus);
router.delete('/:id', deleteApplication);

export default router;
