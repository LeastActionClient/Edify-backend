import { Router } from 'express';
import { createPayment, getPaymentHistory, generateInvoicePDF, getPaymentInvoiceData, deletePayment } from '../controllers/paymentController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.post('/', createPayment);
router.get('/', getPaymentHistory);
router.get('/invoice-data/:id', getPaymentInvoiceData);
router.get('/invoice/:id', generateInvoicePDF);
router.delete('/:id', deletePayment);

export default router;
