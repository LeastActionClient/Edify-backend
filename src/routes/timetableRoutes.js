import { Router } from 'express';
import { authenticate } from '../middlewares/authMiddleware.js';
import {
  getDashboardSummary,
  getSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  seedDefaultSubjects,
  getTeacherSubjects,
  createTeacherSubject,
  deleteTeacherSubject,
  getEligibleTeachers,
  getTeacherAvailability,
  saveTeacherAvailability,
  getTimetableConfig,
  saveTimetableConfig,
  getSubjectRequirements,
  saveSubjectRequirement,
  bulkSaveSubjectRequirements,
  deleteSubjectRequirement,
  getClassTimetable,
  saveTimetableEntry,
  deleteTimetableEntry,
  clearTimetable,
  copyTimetable,
  autoGenerateTimetable,
  publishTimetable,
  unpublishTimetable,
  getTeacherSchedule,
  getAllClassesTimetables,
  getConflicts
} from '../controllers/timetableController.js';

const router = Router();

// Protect all timetable routes with authentication
router.use(authenticate);

// 1. Dashboard Summary
router.get('/dashboard-summary', getDashboardSummary);

// 2. Subjects
router.get('/subjects', getSubjects);
router.post('/subjects', createSubject);
router.put('/subjects/:id', updateSubject);
router.delete('/subjects/:id', deleteSubject);
router.post('/subjects/seed-defaults', seedDefaultSubjects);

// 3. Teacher-Subject Mapping
router.get('/teacher-subjects', getTeacherSubjects);
router.post('/teacher-subjects', createTeacherSubject);
router.delete('/teacher-subjects/:id', deleteTeacherSubject);
router.get('/eligible-teachers', getEligibleTeachers);

// 4. Teacher Availability
router.get('/teacher-availability/:teacherId', getTeacherAvailability);
router.post('/teacher-availability', saveTeacherAvailability);

// 5. Timetable Configuration (Working Days & Periods)
router.get('/config', getTimetableConfig);
router.post('/config', saveTimetableConfig);

// 6. Subject Requirements
router.get('/requirements', getSubjectRequirements);
router.post('/requirements', saveSubjectRequirement);
router.post('/requirements/bulk', bulkSaveSubjectRequirements);
router.delete('/requirements/:id', deleteSubjectRequirement);

// 7. Class Timetable & Entries
router.get('/class', getClassTimetable);
router.post('/entry', saveTimetableEntry);
router.delete('/entry/:id', deleteTimetableEntry);
router.post('/clear', clearTimetable);
router.post('/copy', copyTimetable);
router.post('/generate', autoGenerateTimetable);
router.post('/publish', publishTimetable);
router.post('/unpublish', unpublishTimetable);

// 8. Teacher-Wise Timetable View
router.get('/teacher-schedule/:teacherId', getTeacherSchedule);

// 9. All Classes Consolidated (Print / PDF)
router.get('/all-classes', getAllClassesTimetables);

// 10. Conflict Detection
router.get('/conflicts', getConflicts);

export default router;
