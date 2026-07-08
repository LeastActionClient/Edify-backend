import { Router } from 'express';
import { getDailyCollection, getWeeklyCollection, getMonthlyCollection, getYearlyCollection, getPendingFees, getStudentFeeReport, getCategoryWiseCollection } from '../controllers/reportController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/daily-collection', getDailyCollection);
router.get('/weekly-collection', getWeeklyCollection);
router.get('/monthly-collection', getMonthlyCollection);
router.get('/yearly-collection', getYearlyCollection);
router.get('/pending-fees', getPendingFees);
router.get('/student-fees', getStudentFeeReport);
router.get('/category-collection', getCategoryWiseCollection);

export default router;
