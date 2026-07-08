import { Router } from 'express';
import { 
  getIncludedCharges, 
  getIncludedChargeById, 
  createIncludedCharge, 
  updateIncludedCharge, 
  deleteIncludedCharge 
} from '../controllers/includedChargeController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/', getIncludedCharges);
router.get('/:id', getIncludedChargeById);
router.post('/', createIncludedCharge);
router.put('/:id', updateIncludedCharge);
router.delete('/:id', deleteIncludedCharge);

export default router;
