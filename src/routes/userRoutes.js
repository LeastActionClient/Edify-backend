import { Router } from 'express';
import { createAdmin, updateAdmin, getAdmins, getActivityLogs, deleteAdmin } from '../controllers/userController.js';
import { authenticate, authorizeSuperAdmin } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);
router.use(authorizeSuperAdmin);

router.post('/', createAdmin);
router.put('/:id', updateAdmin);
router.delete('/:id', deleteAdmin);
router.get('/', getAdmins);
router.get('/logs', getActivityLogs);

export default router;
