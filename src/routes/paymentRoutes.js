import { Router } from 'express';
import { createPayment, getPaymentHistory, getStudentPaymentHistory, generateInvoicePDF, getPaymentInvoiceData, deletePayment, sharePaymentWhatsApp, renderFrontendPdf } from '../controllers/paymentController.js';
import { authenticate, authorizeSuperAdmin } from '../middlewares/authMiddleware.js';

const router = Router();

// Public route so parents can download their receipt directly
router.get('/public-invoice/:id', generateInvoicePDF);
router.post('/:id/render-pdf', renderFrontendPdf);

router.use(authenticate);

router.post('/', createPayment);
router.get('/', getPaymentHistory);
router.get('/student-history/:studentId', getStudentPaymentHistory);
router.get('/invoice-data/:id', getPaymentInvoiceData);
router.get('/invoice/:id', generateInvoicePDF);
router.delete('/:id', authorizeSuperAdmin, deletePayment);
router.post('/:id/whatsapp', sharePaymentWhatsApp);

export default router;
