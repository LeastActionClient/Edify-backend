import { Router } from 'express';
import { getFeeCategories, createFeeCategory, updateFeeCategory, deleteFeeCategory, assignFeeToStudent, assignBulkFee } from '../controllers/feeController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/categories', getFeeCategories);
router.post('/categories', createFeeCategory);
router.put('/categories/:id', updateFeeCategory);
router.delete('/categories/:id', deleteFeeCategory);

router.post('/assign-bulk', assignBulkFee);
router.post('/assign/:studentId', assignFeeToStudent);

export default router;
