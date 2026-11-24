import {
  Timetable,
  TimetableEntry,
  TimetableConfig,
  Subject,
  TeacherSubject,
  TeacherAvailability,
  SubjectRequirement,
  Teacher,
  Class,
  Section,
  AcademicYear,
  ActivityLog
} from '../models/index.js';
import {
  validateTimetableEntry,
  scanForConflicts
} from '../services/timetableValidationService.js';
import { generateClassTimetable } from '../services/timetableGeneratorService.js';

// Helper to get active academic year
const getActiveAcademicYear = async () => {
  const activeYear = await AcademicYear.findOne({ status: 'Active' }).lean();
  return activeYear?.year || '2026–2027';
};

// -------------------------------------------------------------
// 1. DASHBOARD SUMMARY STATS
// -------------------------------------------------------------
export const getDashboardSummary = async (req, res) => {
  try {
    const academicYear = req.query.academicYear || (await getActiveAcademicYear());

    const [
      totalClasses,
      totalTeachers,
      totalSubjects,
      totalScheduledPeriods,
      timetables,
      conflicts,
      config
    ] = await Promise.all([
      Class.countDocuments(),
      Teacher.countDocuments(),
      Subject.countDocuments({ isActive: true }),
      TimetableEntry.countDocuments({ academicYear, isBreak: false, teacherId: { $ne: null } }),
      Timetable.find({ academicYear }).lean(),
      scanForConflicts(academicYear),
      TimetableConfig.findOne({ academicYear, classId: null }).lean()
    ]);

    const publishedCount = timetables.filter(t => t.isPublished).length;
    const draftCount = timetables.filter(t => !t.isPublished).length;

    // Calculate unassigned slots estimate
    const workingDaysCount = config?.workingDays?.length || 6;
    const teachingPeriodsCount = config?.periods?.filter(p => !p.isBreak)?.length || 8;
    const totalPossibleSlots = totalClasses * workingDaysCount * teachingPeriodsCount;
    const unassignedPeriods = Math.max(0, totalPossibleSlots - totalScheduledPeriods);

    res.json({
      academicYear,
      totalClasses,
      totalTeachers,
      totalSubjects,
      totalScheduledPeriods,
      unassignedPeriods,
      teacherConflicts: conflicts.length,
      conflictsList: conflicts,
      publicationStatus: {
        totalTimetables: timetables.length,
        publishedCount,
        draftCount
      }
    });
  } catch (error) {
    console.error('Error in getDashboardSummary:', error);
    res.status(500).json({ error: error.message || 'Error fetching timetable dashboard summary' });
  }
};

// -------------------------------------------------------------
// 2. SUBJECTS
// -------------------------------------------------------------
export const getSubjects = async (req, res) => {
  try {
    const subjects = await Subject.find().sort({ category: 1, name: 1 }).lean();
    res.json(subjects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createSubject = async (req, res) => {
  try {
    const { name, code, category, color, defaultWeeklyPeriods } = req.body;
    if (!name || !code) {
      return res.status(400).json({ error: 'Subject Name and Code are required.' });
    }

    const existing = await Subject.findOne({
      $or: [
        { name: new RegExp(`^${name.trim()}$`, 'i') },
        { code: new RegExp(`^${code.trim()}$`, 'i') }
      ]
    });
    if (existing) {
      return res.status(400).json({ error: 'A subject with this name or code already exists.' });
    }

    const subject = await Subject.create({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      category: category || 'Core',
      color: color || '#3B82F6',
      defaultWeeklyPeriods: Number(defaultWeeklyPeriods) || 5
    });

    res.status(201).json(subject);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const updateSubject = async (req, res) => {
  try {
    const { name, code, category, color, defaultWeeklyPeriods, isActive } = req.body;
    const subject = await Subject.findByIdAndUpdate(
      req.params.id,
      {
        ...(name ? { name: name.trim() } : {}),
        ...(code ? { code: code.trim().toUpperCase() } : {}),
        ...(category ? { category } : {}),
        ...(color ? { color } : {}),
        ...(defaultWeeklyPeriods !== undefined ? { defaultWeeklyPeriods: Number(defaultWeeklyPeriods) } : {}),
        ...(isActive !== undefined ? { isActive } : {})
      },
      { new: true }
    );
    if (!subject) return res.status(404).json({ error: 'Subject not found' });
    res.json(subject);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteSubject = async (req, res) => {
  try {
    // Check if subject is used in any entries
    const inUse = await TimetableEntry.findOne({ subjectId: req.params.id });
    if (inUse) {
      return res.status(400).json({ error: 'Cannot delete subject that is assigned in timetables. Please remove it from timetables first or deactivate it.' });
    }
    await Promise.all([
      Subject.findByIdAndDelete(req.params.id),
      TeacherSubject.deleteMany({ subjectId: req.params.id }),
      SubjectRequirement.deleteMany({ subjectId: req.params.id })
    ]);
    res.json({ message: 'Subject deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const seedDefaultSubjects = async (req, res) => {
  try {
    const defaults = [
      { name: 'English', code: 'ENG', category: 'Language', color: '#3B82F6', defaultWeeklyPeriods: 6 },
      { name: 'Tamil', code: 'TAM', category: 'Language', color: '#10B981', defaultWeeklyPeriods: 6 },
      { name: 'Mathematics', code: 'MATH', category: 'Core', color: '#EF4444', defaultWeeklyPeriods: 7 },
      { name: 'Science', code: 'SCI', category: 'Core', color: '#8B5CF6', defaultWeeklyPeriods: 6 },
      { name: 'Social Science', code: 'SOC', category: 'Core', color: '#F59E0B', defaultWeeklyPeriods: 5 },
      { name: 'Hindi', code: 'HIN', category: 'Language', color: '#EC4899', defaultWeeklyPeriods: 3 },
      { name: 'Computer Science', code: 'CS', category: 'Science/Lab', color: '#06B6D4', defaultWeeklyPeriods: 2 },
      { name: 'Physical Education', code: 'PE', category: 'Activity', color: '#14B8A6', defaultWeeklyPeriods: 2 },
      { name: 'Art & Craft', code: 'ART', category: 'Activity', color: '#F97316', defaultWeeklyPeriods: 1 },
      { name: 'Moral Science / GK', code: 'GK', category: 'General', color: '#6366F1', defaultWeeklyPeriods: 1 }
    ];

    let createdCount = 0;
    for (const item of defaults) {
      const exists = await Subject.findOne({
        $or: [{ name: item.name }, { code: item.code }]
      });
      if (!exists) {
        await Subject.create(item);
        createdCount++;
      }
    }

    const allSubjects = await Subject.find().sort({ name: 1 });
    res.json({ message: `Seeded ${createdCount} default subjects.`, subjects: allSubjects });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// -------------------------------------------------------------
// 3. TEACHER-SUBJECT MAPPING
// -------------------------------------------------------------
export const getTeacherSubjects = async (req, res) => {
  try {
    const filter = {};
    if (req.query.teacherId) filter.teacherId = req.query.teacherId;
    if (req.query.subjectId) filter.subjectId = req.query.subjectId;

    const mappings = await TeacherSubject.find(filter)
      .populate('teacherId', 'name teacherId designation phoneNumber')
      .populate('subjectId', 'name code color category defaultWeeklyPeriods')
      .lean();
    res.json(mappings.filter(m => m.teacherId && m.subjectId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createTeacherSubject = async (req, res) => {
  try {
    const { teacherId, subjectId, classes, maxWeeklyPeriods } = req.body;
    if (!teacherId || !subjectId) {
      return res.status(400).json({ error: 'Teacher and Subject are required.' });
    }

    const existing = await TeacherSubject.findOne({ teacherId, subjectId });
    if (existing) {
      if (classes !== undefined) existing.classes = classes || [];
      if (maxWeeklyPeriods) existing.maxWeeklyPeriods = Number(maxWeeklyPeriods);
      await existing.save();
      const populated = await TeacherSubject.findById(existing._id)
        .populate('teacherId')
        .populate('subjectId');
      return res.json(populated);
    }

    const created = await TeacherSubject.create({
      teacherId,
      subjectId,
      classes: classes || [],
      maxWeeklyPeriods: Number(maxWeeklyPeriods) || 30
    });

    const populated = await TeacherSubject.findById(created._id)
      .populate('teacherId')
      .populate('subjectId');
    res.status(201).json(populated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteTeacherSubject = async (req, res) => {
  try {
    await TeacherSubject.findByIdAndDelete(req.params.id);
    res.json({ message: 'Teacher-Subject mapping removed.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getEligibleTeachers = async (req, res) => {
  try {
    const { subjectId, className } = req.query;
    if (!subjectId) {
      return res.status(400).json({ error: 'subjectId is required' });
    }

    const mappings = await TeacherSubject.find({ subjectId })
      .populate('teacherId')
      .lean();

    const eligible = mappings
      .filter(m => {
        if (!m.teacherId) return false;
        if (!m.classes || m.classes.length === 0) return true;
        if (!className) return true;
        const normalizedClassName = String(className).trim().toLowerCase();
        return m.classes.some(c => {
          const norm = String(c).trim().toLowerCase();
          return norm === 'all' || norm === normalizedClassName;
        });
      })
      .map(m => ({
        ...m.teacherId,
        mappingId: m._id,
        maxWeeklyPeriods: m.maxWeeklyPeriods
      }));

    res.json(eligible);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// -------------------------------------------------------------
// 4. TEACHER AVAILABILITY
// -------------------------------------------------------------
export const getTeacherAvailability = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const academicYear = req.query.academicYear || (await getActiveAcademicYear());

    let availability = await TeacherAvailability.findOne({ teacherId, academicYear }).lean();
    if (!availability) {
      availability = {
        teacherId,
        academicYear,
        unavailableSlots: [],
        maxDailyPeriods: 6,
        maxWeeklyPeriods: 30
      };
    }
    res.json(availability);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const saveTeacherAvailability = async (req, res) => {
  try {
    const { teacherId, academicYear, unavailableSlots, maxDailyPeriods, maxWeeklyPeriods } = req.body;
    if (!teacherId) return res.status(400).json({ error: 'teacherId is required' });

    const year = academicYear || (await getActiveAcademicYear());

    const availability = await TeacherAvailability.findOneAndUpdate(
      { teacherId, academicYear: year },
      {
        unavailableSlots: unavailableSlots || [],
        maxDailyPeriods: Number(maxDailyPeriods) || 6,
        maxWeeklyPeriods: Number(maxWeeklyPeriods) || 30
      },
      { upsert: true, new: true }
    );

    res.json(availability);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// -------------------------------------------------------------
// 5. TIMETABLE CONFIGURATION (Periods & Working Days)
// -------------------------------------------------------------
export const getTimetableConfig = async (req, res) => {
  try {
    const academicYear = req.query.academicYear || (await getActiveAcademicYear());
    const classId = req.query.classId || null;

    let config = null;
    if (classId) {
      config = await TimetableConfig.findOne({ academicYear, classId }).lean();
    }
    if (!config) {
      config = await TimetableConfig.findOne({ academicYear, classId: null }).lean();
    }

    if (!config) {
      // Default template
      const defaultPeriods = [
        { periodNumber: 1, name: 'Period 1', startTime: '09:00', endTime: '09:45', type: 'teaching', isBreak: false },
        { periodNumber: 2, name: 'Period 2', startTime: '09:45', endTime: '10:30', type: 'teaching', isBreak: false },
        { periodNumber: 3, name: 'Morning Break', startTime: '10:30', endTime: '10:45', type: 'break', isBreak: true },
        { periodNumber: 4, name: 'Period 3', startTime: '10:45', endTime: '11:30', type: 'teaching', isBreak: false },
        { periodNumber: 5, name: 'Period 4', startTime: '11:30', endTime: '12:15', type: 'teaching', isBreak: false },
        { periodNumber: 6, name: 'Lunch Break', startTime: '12:15', endTime: '01:00', type: 'lunch', isBreak: true },
        { periodNumber: 7, name: 'Period 5', startTime: '01:00', endTime: '01:45', type: 'teaching', isBreak: false },
        { periodNumber: 8, name: 'Period 6', startTime: '01:45', endTime: '02:30', type: 'teaching', isBreak: false },
        { periodNumber: 9, name: 'Period 7', startTime: '02:30', endTime: '03:15', type: 'teaching', isBreak: false },
        { periodNumber: 10, name: 'Period 8', startTime: '03:15', endTime: '04:00', type: 'teaching', isBreak: false }
      ];
      config = await TimetableConfig.create({
        academicYear,
        classId: null,
        className: 'All',
        workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        periods: defaultPeriods
      });
    }

    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const saveTimetableConfig = async (req, res) => {
  try {
    const { academicYear, classId, className, workingDays, periods } = req.body;
    const year = academicYear || (await getActiveAcademicYear());

    if (!periods || periods.length === 0) {
      return res.status(400).json({ error: 'At least one period slot is required.' });
    }

    const config = await TimetableConfig.findOneAndUpdate(
      { academicYear: year, classId: classId || null },
      {
        className: className || 'All',
        workingDays: workingDays || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        periods
      },
      { upsert: true, new: true }
    );

    res.json(config);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// -------------------------------------------------------------
// 6. SUBJECT REQUIREMENTS
// -------------------------------------------------------------
export const getSubjectRequirements = async (req, res) => {
  try {
    const academicYear = req.query.academicYear || (await getActiveAcademicYear());
    const { classId, sectionId } = req.query;

    const filter = { academicYear };
    if (classId) filter.classId = classId;
    if (sectionId) filter.sectionId = sectionId;

    const reqs = await SubjectRequirement.find(filter)
      .populate('subjectId')
      .populate('preferredTeacherId')
      .lean();

    res.json(reqs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const saveSubjectRequirement = async (req, res) => {
  try {
    const { academicYear, classId, className, sectionId, sectionName, subjectId, weeklyPeriods, preferredTeacherId, priority, maxPerDay } = req.body;
    const year = academicYear || (await getActiveAcademicYear());

    const doc = await SubjectRequirement.findOneAndUpdate(
      {
        academicYear: year,
        classId,
        sectionId: sectionId || null,
        subjectId
      },
      {
        className,
        sectionName: sectionName || '',
        weeklyPeriods: Number(weeklyPeriods) || 5,
        preferredTeacherId: preferredTeacherId || null,
        priority: priority || 'Medium',
        maxPerDay: Number(maxPerDay) || 2
      },
      { upsert: true, new: true }
    ).populate('subjectId preferredTeacherId');

    res.json(doc);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const bulkSaveSubjectRequirements = async (req, res) => {
  try {
    const { academicYear, classId, className, sectionId, sectionName, requirements } = req.body;
    const year = academicYear || (await getActiveAcademicYear());

    if (!Array.isArray(requirements)) {
      return res.status(400).json({ error: 'requirements must be an array.' });
    }

    const results = [];
    for (const r of requirements) {
      if (r.subjectId) {
        const updated = await SubjectRequirement.findOneAndUpdate(
          {
            academicYear: year,
            classId,
            sectionId: sectionId || null,
            subjectId: r.subjectId
          },
          {
            className,
            sectionName: sectionName || '',
            weeklyPeriods: Number(r.weeklyPeriods) || 5,
            preferredTeacherId: r.preferredTeacherId || null,
            priority: r.priority || 'Medium',
            maxPerDay: Number(r.maxPerDay) || 2
          },
          { upsert: true, new: true }
        );
        results.push(updated);
      }
    }

    res.json({ message: 'Requirements saved successfully', count: results.length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteSubjectRequirement = async (req, res) => {
  try {
    await SubjectRequirement.findByIdAndDelete(req.params.id);
    res.json({ message: 'Subject requirement deleted.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// -------------------------------------------------------------
// 7. TIMETABLE & ENTRIES MANAGEMENT
// -------------------------------------------------------------
export const getClassTimetable = async (req, res) => {
  try {
    const academicYear = req.query.academicYear || (await getActiveAcademicYear());
    const { classId, sectionId } = req.query;

    if (!classId) {
      return res.status(400).json({ error: 'classId is required' });
    }

    const cls = await Class.findById(classId).lean();
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    let timetable = await Timetable.findOne({
      academicYear,
      classId,
      sectionId: sectionId || null
    }).lean();

    if (!timetable) {
      timetable = await Timetable.create({
        academicYear,
        classId,
        className: cls.name,
        sectionId: sectionId || null,
        sectionName: req.query.sectionName || '',
        status: 'Draft',
        isPublished: false
      });
      timetable = timetable.toObject();
    }

    const entries = await TimetableEntry.find({ timetableId: timetable._id })
      .populate('subjectId', 'name code color category')
      .populate('teacherId', 'name teacherId designation phoneNumber photo')
      .lean();

    // Get period config for this class
    let config = await TimetableConfig.findOne({ academicYear, classId }).lean();
    if (!config) {
      config = await TimetableConfig.findOne({ academicYear, classId: null }).lean();
    }

    res.json({
      timetable,
      config,
      entries
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const saveTimetableEntry = async (req, res) => {
  try {
    const {
      timetableId,
      academicYear,
      classId,
      className,
      sectionId,
      sectionName,
      day,
      periodNumber,
      startTime,
      endTime,
      isBreak,
      breakTitle,
      subjectId,
      teacherId,
      room,
      entryId
    } = req.body;

    const year = academicYear || (await getActiveAcademicYear());

    // 1. Check if timetable is published
    const timetable = await Timetable.findById(timetableId);
    if (!timetable) {
      return res.status(404).json({ error: 'Timetable not found.' });
    }

    // If published, only ADMIN / SUPER_ADMIN can edit
    if (timetable.isPublished && !['SUPER_ADMIN', 'ADMIN'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Only administrators can modify a published timetable.' });
    }

    // 2. Strict Pre-Save Business Rule Validation
    const validationError = await validateTimetableEntry({
      timetableId,
      academicYear: year,
      classId,
      className: className || timetable.className,
      sectionId: sectionId || timetable.sectionId,
      sectionName: sectionName || timetable.sectionName,
      day,
      periodNumber: Number(periodNumber),
      subjectId,
      teacherId,
      isBreak: Boolean(isBreak),
      breakTitle,
      entryId
    });

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // 3. Look up names if provided
    let subjectName = '';
    if (subjectId) {
      const s = await Subject.findById(subjectId).lean();
      subjectName = s?.name || '';
    }
    let teacherName = '';
    if (teacherId) {
      const t = await Teacher.findById(teacherId).lean();
      teacherName = t?.name || '';
    }

    // 4. Save entry (upsert)
    let savedEntry;
    try {
      if (entryId) {
        savedEntry = await TimetableEntry.findByIdAndUpdate(
          entryId,
          {
            day,
            periodNumber: Number(periodNumber),
            startTime: startTime || '',
            endTime: endTime || '',
            isBreak: Boolean(isBreak),
            breakTitle: breakTitle || '',
            subjectId: subjectId || null,
            subjectName,
            teacherId: teacherId || null,
            teacherName,
            room: room || ''
          },
          { new: true }
        );
      } else {
        // Find existing cell in this timetable to update or create
        savedEntry = await TimetableEntry.findOneAndUpdate(
          {
            timetableId,
            day,
            periodNumber: Number(periodNumber)
          },
          {
            academicYear: year,
            classId,
            className: className || timetable.className,
            sectionId: sectionId || timetable.sectionId || null,
            sectionName: sectionName || timetable.sectionName || '',
            startTime: startTime || '',
            endTime: endTime || '',
            isBreak: Boolean(isBreak),
            breakTitle: breakTitle || '',
            subjectId: subjectId || null,
            subjectName,
            teacherId: teacherId || null,
            teacherName,
            room: room || ''
          },
          { upsert: true, new: true }
        );
      }
    } catch (dbError) {
      // Database level duplicate key protection (E11000)
      if (dbError.code === 11000) {
        if (dbError.message.includes('teacherId')) {
          return res.status(400).json({
            error: `Teacher conflict prevented by database: This teacher is already allocated to another class in ${day} Period ${periodNumber}.`
          });
        }
        return res.status(400).json({
          error: `Period conflict prevented by database: Class already has a schedule for ${day} Period ${periodNumber}.`
        });
      }
      throw dbError;
    }

    timetable.updatedBy = req.user?.id;
    await timetable.save();

    const populated = await TimetableEntry.findById(savedEntry._id)
      .populate('subjectId')
      .populate('teacherId');

    res.json(populated);
  } catch (error) {
    console.error('Error saving timetable entry:', error);
    res.status(400).json({ error: error.message || 'Error saving timetable entry' });
  }
};

export const deleteTimetableEntry = async (req, res) => {
  try {
    const entry = await TimetableEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });

    const timetable = await Timetable.findById(entry.timetableId);
    if (timetable?.isPublished && !['SUPER_ADMIN', 'ADMIN'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Only administrators can modify a published timetable.' });
    }

    await TimetableEntry.findByIdAndDelete(req.params.id);
    res.json({ message: 'Entry removed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const clearTimetable = async (req, res) => {
  try {
    const { timetableId } = req.body;
    const timetable = await Timetable.findById(timetableId);
    if (!timetable) return res.status(404).json({ error: 'Timetable not found' });

    if (timetable.isPublished && !['SUPER_ADMIN', 'ADMIN'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Only administrators can modify a published timetable.' });
    }

    await TimetableEntry.deleteMany({ timetableId });
    timetable.status = 'Draft';
    timetable.isPublished = false;
    await timetable.save();

    res.json({ message: 'All timetable entries cleared.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const copyTimetable = async (req, res) => {
  try {
    const { sourceTimetableId, targetTimetableId } = req.body;
    if (!sourceTimetableId || !targetTimetableId) {
      return res.status(400).json({ error: 'sourceTimetableId and targetTimetableId are required' });
    }

    const [source, target] = await Promise.all([
      Timetable.findById(sourceTimetableId),
      Timetable.findById(targetTimetableId)
    ]);

    if (!source || !target) {
      return res.status(404).json({ error: 'Source or target timetable not found.' });
    }

    if (target.isPublished && !['SUPER_ADMIN', 'ADMIN'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Cannot overwrite a published timetable without admin authorization.' });
    }

    const sourceEntries = await TimetableEntry.find({ timetableId: source._id }).lean();
    if (sourceEntries.length === 0) {
      return res.status(400).json({ error: 'Source timetable has no entries to copy.' });
    }

    // Check teacher clashes for target before copying
    const clashes = [];
    for (const entry of sourceEntries) {
      if (!entry.isBreak && entry.teacherId) {
        const clash = await TimetableEntry.findOne({
          academicYear: target.academicYear,
          timetableId: { $ne: target._id },
          day: entry.day,
          periodNumber: entry.periodNumber,
          teacherId: entry.teacherId
        }).lean();
        if (clash) {
          clashes.push(`Teacher ${entry.teacherName} is already assigned to ${clash.className} on ${entry.day} Period ${entry.periodNumber}.`);
        }
      }
    }

    if (clashes.length > 0) {
      return res.status(400).json({
        error: `Cannot copy timetable due to teacher clashes:\n${clashes.slice(0, 3).join('\n')}${clashes.length > 3 ? `\n...and ${clashes.length - 3} more` : ''}`
      });
    }

    // Wipe target entries and copy
    await TimetableEntry.deleteMany({ timetableId: target._id });

    const newEntries = sourceEntries.map(e => ({
      timetableId: target._id,
      academicYear: target.academicYear,
      classId: target.classId,
      className: target.className,
      sectionId: target.sectionId,
      sectionName: target.sectionName,
      day: e.day,
      periodNumber: e.periodNumber,
      startTime: e.startTime,
      endTime: e.endTime,
      isBreak: e.isBreak,
      breakTitle: e.breakTitle,
      subjectId: e.subjectId,
      subjectName: e.subjectName,
      teacherId: e.teacherId,
      teacherName: e.teacherName,
      room: e.room
    }));

    await TimetableEntry.insertMany(newEntries);

    target.status = 'Draft';
    target.isPublished = false;
    target.updatedBy = req.user?.id;
    await target.save();

    res.json({ message: `Copied ${newEntries.length} entries successfully.`, targetTimetableId: target._id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const autoGenerateTimetable = async (req, res) => {
  try {
    const { academicYear, classId, className, sectionId, sectionName } = req.body;
    const year = academicYear || (await getActiveAcademicYear());

    if (!classId) return res.status(400).json({ error: 'classId is required' });

    const result = await generateClassTimetable({
      academicYear: year,
      classId,
      className,
      sectionId,
      sectionName,
      userId: req.user?.id
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('Error in autoGenerateTimetable:', error);
    res.status(500).json({ error: error.message || 'Error generating timetable' });
  }
};

export const publishTimetable = async (req, res) => {
  try {
    const { timetableId } = req.body;
    const timetable = await Timetable.findById(timetableId);
    if (!timetable) return res.status(404).json({ error: 'Timetable not found' });

    // Validate if timetable has entries
    const entriesCount = await TimetableEntry.countDocuments({ timetableId, isBreak: false, teacherId: { $ne: null } });
    if (entriesCount === 0) {
      return res.status(400).json({ error: 'Cannot publish an empty timetable. Please add periods or auto-generate first.' });
    }

    // Scan for any clashes before publishing
    const conflicts = await scanForConflicts(timetable.academicYear);
    const relatedConflicts = conflicts.filter(c =>
      c.entryA.className === timetable.className || c.entryB.className === timetable.className
    );
    if (relatedConflicts.length > 0) {
      return res.status(400).json({
        error: `Cannot publish timetable with teacher clashes: ${relatedConflicts[0].message}`
      });
    }

    timetable.isPublished = true;
    timetable.status = 'Published';
    timetable.publishedAt = new Date();
    timetable.publishedBy = req.user?.id;
    await timetable.save();

    res.json({ message: 'Timetable published successfully!', timetable });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const unpublishTimetable = async (req, res) => {
  try {
    const { timetableId } = req.body;
    const timetable = await Timetable.findById(timetableId);
    if (!timetable) return res.status(404).json({ error: 'Timetable not found' });

    timetable.isPublished = false;
    timetable.status = 'Draft';
    await timetable.save();

    res.json({ message: 'Timetable unpublished. It is now in Draft mode.', timetable });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// -------------------------------------------------------------
// 8. TEACHER-WISE TIMETABLE VIEW
// -------------------------------------------------------------
export const getTeacherSchedule = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const academicYear = req.query.academicYear || (await getActiveAcademicYear());

    const teacher = await Teacher.findById(teacherId).lean();
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    const entries = await TimetableEntry.find({
      academicYear,
      teacherId,
      isBreak: false
    })
      .populate('subjectId', 'name code color category')
      .lean();

    // Fetch config for working days and periods
    let config = await TimetableConfig.findOne({ academicYear, classId: null }).lean();
    if (!config) {
      config = {
        workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        periods: []
      };
    }

    // Structure schedule grid: [day][periodNumber] = entry
    const schedule = {};
    for (const d of config.workingDays) {
      schedule[d] = {};
    }

    for (const entry of entries) {
      if (!schedule[entry.day]) schedule[entry.day] = {};
      schedule[entry.day][entry.periodNumber] = entry;
    }

    // Count assigned and free periods
    const teachingPeriods = config.periods.filter(p => !p.isBreak);
    const totalPossiblePeriods = config.workingDays.length * teachingPeriods.length;
    const assignedPeriodsCount = entries.length;
    const freePeriodsCount = Math.max(0, totalPossiblePeriods - assignedPeriodsCount);

    // Fetch assigned subjects for this teacher
    const teacherSubjects = await TeacherSubject.find({ teacherId })
      .populate('subjectId', 'name code color category defaultWeeklyPeriods')
      .lean();

    res.json({
      teacher,
      academicYear,
      config,
      schedule,
      entries,
      teacherSubjects: teacherSubjects.filter(ts => ts.subjectId),
      stats: {
        totalWeeklySlots: totalPossiblePeriods,
        assignedPeriods: assignedPeriodsCount,
        freePeriods: freePeriodsCount
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// -------------------------------------------------------------
// 9. CONSOLIDATED ALL-CLASSES TIMETABLE (For batch print / export)
// -------------------------------------------------------------
export const getAllClassesTimetables = async (req, res) => {
  try {
    const academicYear = req.query.academicYear || (await getActiveAcademicYear());

    const [timetables, classes, config] = await Promise.all([
      Timetable.find({ academicYear }).lean(),
      Class.find().sort({ name: 1 }).lean(),
      TimetableConfig.findOne({ academicYear, classId: null }).lean()
    ]);

    const timetableIds = timetables.map(t => t._id);
    const allEntries = await TimetableEntry.find({ timetableId: { $in: timetableIds } })
      .populate('subjectId', 'name code color')
      .populate('teacherId', 'name designation')
      .lean();

    const entriesByTimetable = {};
    for (const e of allEntries) {
      const tid = e.timetableId.toString();
      if (!entriesByTimetable[tid]) entriesByTimetable[tid] = [];
      entriesByTimetable[tid].push(e);
    }

    const result = timetables.map(t => ({
      ...t,
      entries: entriesByTimetable[t._id.toString()] || []
    }));

    res.json({
      academicYear,
      config,
      timetables: result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// -------------------------------------------------------------
// 10. REAL-TIME CONFLICT SCAN
// -------------------------------------------------------------
export const getConflicts = async (req, res) => {
  try {
    const academicYear = req.query.academicYear || (await getActiveAcademicYear());
    const conflicts = await scanForConflicts(academicYear);
    res.json({
      academicYear,
      count: conflicts.length,
      conflicts
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
