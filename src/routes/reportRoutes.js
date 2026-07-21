import { Router } from 'express';
import { getDashboardOverview, getDailyCollection, getWeeklyCollection, getMonthlyCollection, getYearlyCollection, getPendingFees, getStudentFeeReport, getCategoryWiseCollection, getCustomCollection } from '../controllers/reportController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/overview', getDashboardOverview);
router.get('/daily-collection', getDailyCollection);
router.get('/weekly-collection', getWeeklyCollection);
router.get('/monthly-collection', getMonthlyCollection);
router.get('/yearly-collection', getYearlyCollection);
router.get('/custom-collection', getCustomCollection);
router.get('/pending-fees', getPendingFees);
router.get('/student-fees', getStudentFeeReport);
router.get('/category-collection', getCategoryWiseCollection);

export default router;
