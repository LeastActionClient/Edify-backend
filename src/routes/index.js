import { Router } from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import applicationRoutes from './applicationRoutes.js';
import studentRoutes from './studentRoutes.js';
import feeRoutes from './feeRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import reportRoutes from './reportRoutes.js';
import classRoutes from './classRoutes.js';
import settingsRoutes from './settingsRoutes.js';
import includedChargeRoutes from './includedChargeRoutes.js';
import activityRoutes from './activityRoutes.js';
import exportRoutes from './exportRoutes.js';
import academicYearRoutes from './academicYearRoutes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/applications', applicationRoutes);
router.use('/students', studentRoutes);
router.use('/fees', feeRoutes);
router.use('/payments', paymentRoutes);
router.use('/reports', reportRoutes);
router.use('/classes', classRoutes);
router.use('/settings', settingsRoutes);
router.use('/included-charges', includedChargeRoutes);
router.use('/activities', activityRoutes);
router.use('/exports', exportRoutes);
router.use('/academic-years', academicYearRoutes);


export default router;
