import { Router } from 'express';
import { 
  getIncludedCharges, 
  getIncludedChargeById, 
  createIncludedCharge, 
  updateIncludedCharge, 
  deleteIncludedCharge,
  getIncludedChargeStockTransactions,
  adjustIncludedChargeStock
} from '../controllers/includedChargeController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/', getIncludedCharges);
router.get('/:id', getIncludedChargeById);
router.get('/:id/stock-transactions', getIncludedChargeStockTransactions);
router.post('/', createIncludedCharge);
router.post('/:id/stock', adjustIncludedChargeStock);
router.put('/:id', updateIncludedCharge);
router.delete('/:id', deleteIncludedCharge);

export default router;
