import { Router } from 'express';
import { createPayment, getPaymentHistory, generateInvoicePDF, getPaymentInvoiceData, deletePayment, sharePaymentWhatsApp } from '../controllers/paymentController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

// Public route so parents can download their receipt directly
router.get('/public-invoice/:id', generateInvoicePDF);

router.use(authenticate);

router.post('/', createPayment);
router.get('/', getPaymentHistory);
router.get('/invoice-data/:id', getPaymentInvoiceData);
router.get('/invoice/:id', generateInvoicePDF);
router.delete('/:id', deletePayment);
router.post('/:id/whatsapp', sharePaymentWhatsApp);

export default router;
