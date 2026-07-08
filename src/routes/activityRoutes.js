import { Router } from 'express';
import { 
  getActivities, 
  getActivityById, 
  createActivity, 
  updateActivity, 
  deleteActivity 
} from '../controllers/activityController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authenticate);

router.get('/', getActivities);
router.get('/:id', getActivityById);
router.post('/', createActivity);
router.put('/:id', updateActivity);
router.delete('/:id', deleteActivity);

export default router;
