import { Router } from 'express';
import multer from 'multer';
import { getStudents, getStudentById, addStudentManually, bulkImportStudents, deleteStudent, removeFeeFromStudent, updateStudent, promoteStudents, getNextAdmissionNumber, uploadStudentPhoto } from '../controllers/studentController.js';
import { uploadPhoto } from '../middlewares/uploadMiddleware.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });


router.use(authenticate);

router.post('/upload-photo', uploadPhoto.single('photo'), uploadStudentPhoto);
router.get('/', getStudents);
router.get('/next-admission-number', getNextAdmissionNumber);
router.post('/promote', promoteStudents);
router.post('/manual', addStudentManually);
router.post('/bulk-import', upload.single('file'), bulkImportStudents);
router.get('/:id', getStudentById);
router.put('/:id', updateStudent);
router.delete('/:id', deleteStudent);
router.delete('/:studentId/fees/:feeId', removeFeeFromStudent);

export default router;
