import { Router } from 'express';
import {
  getAccounts,
  updateTotalAmount,
  createExpense,
  deleteExpense
} from '../controllers/accountController.js';
import { authenticate, authorizeSuperAdmin } from '../middlewares/authMiddleware.js';

const router = Router();

// Strictly protect all accounts endpoints for SUPER_ADMIN role only
router.use(authenticate);
router.use(authorizeSuperAdmin);

router.get('/', getAccounts);
router.put('/total-amount', updateTotalAmount);
router.post('/expenses', createExpense);
router.delete('/expenses/:id', deleteExpense);

export default router;
