import {
  Timetable,
  TimetableEntry,
  TimetableConfig,
  SubjectRequirement,
  Subject,
  Teacher,
  TeacherSubject,
  TeacherAvailability
} from '../models/index.js';
import { validateTimetableEntry } from './timetableValidationService.js';

/**
 * Smart Timetable Generator
 * Solves class timetable without teacher clashes, class clashes, and respects all constraints.
 */
export const generateClassTimetable = async ({
  academicYear,
  classId,
  className,
  sectionId = null,
  sectionName = '',
  userId = null
}) => {
  // 1. Get or create Timetable document
  let timetable = await Timetable.findOne({
    academicYear,
    classId,
    sectionId: sectionId || null
  });

  if (!timetable) {
    timetable = await Timetable.create({
      academicYear,
      classId,
      className,
      sectionId: sectionId || null,
      sectionName: sectionName || '',
      status: 'Draft',
      isPublished: false,
      createdBy: userId,
      updatedBy: userId
    });
  } else if (timetable.isPublished) {
    return {
      success: false,
      error: 'Cannot regenerate a Published timetable. Please unpublish the timetable first.'
    };
  }

  // 2. Fetch Period Configuration (class-specific or default)
  let config = await TimetableConfig.findOne({ academicYear, classId }).lean();
  if (!config) {
    config = await TimetableConfig.findOne({ academicYear, classId: null }).lean();
  }

  // If no config found, create a standard default configuration
  if (!config || !config.periods || config.periods.length === 0) {
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

  const workingDays = config.workingDays && config.workingDays.length > 0
    ? config.workingDays
    : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const allConfigPeriods = config.periods.slice().sort((a, b) => a.periodNumber - b.periodNumber);
  const teachingPeriods = allConfigPeriods.filter(p => !p.isBreak && p.type === 'teaching');
  const breakPeriods = allConfigPeriods.filter(p => p.isBreak);

  const totalTeachingSlots = workingDays.length * teachingPeriods.length;

  // 3. Fetch Subject Requirements for this class/section
  let requirements = await SubjectRequirement.find({
    academicYear,
    classId,
    ...(sectionId ? { $or: [{ sectionId }, { sectionId: null }] } : {})
  }).populate('subjectId preferredTeacherId').lean();

  // If no requirements configured, check if active subjects exist and build default requirements
  if (requirements.length === 0) {
    const activeSubjects = await Subject.find({ isActive: true }).lean();
    if (activeSubjects.length === 0) {
      return {
        success: false,
        error: 'No active subjects found in the system. Please create subjects in Timetable Settings first.'
      };
    }

    // Auto-create sensible default requirements
    const defaultReqs = [];
    for (const sub of activeSubjects) {
      defaultReqs.push({
        academicYear,
        classId,
        className,
        sectionId: sectionId || null,
        sectionName: sectionName || '',
        subjectId: sub._id,
        weeklyPeriods: sub.defaultWeeklyPeriods || 5,
        priority: sub.category === 'Core' ? 'High' : (sub.category === 'Language' ? 'Medium' : 'Low'),
        maxPerDay: 2
      });
    }
    const createdReqs = await SubjectRequirement.insertMany(defaultReqs);
    requirements = await SubjectRequirement.find({
      _id: { $in: createdReqs.map(r => r._id) }
    }).populate('subjectId preferredTeacherId').lean();
  }

  // Calculate total required weekly periods
  const totalRequiredPeriods = requirements.reduce((sum, r) => sum + (r.weeklyPeriods || 0), 0);
  if (totalRequiredPeriods > totalTeachingSlots) {
    return {
      success: false,
      error: `Cannot generate timetable: The total weekly required subject periods (${totalRequiredPeriods}) exceed the total available teaching periods (${totalTeachingSlots}) for class ${className}. Please reduce weekly periods in Subject Requirements or add more teaching periods.`
    };
  }

  // 4. Check eligible teachers for each subject
  const subjectTeachersMap = new Map();
  for (const req of requirements) {
    const subIdStr = req.subjectId._id.toString();
    const mappings = await TeacherSubject.find({ subjectId: req.subjectId._id })
      .populate('teacherId')
      .lean();

    // Filter by class if mapping has class restrictions
    const eligibleTeachers = mappings
      .filter(m => m.teacherId && (!m.classes || m.classes.length === 0 || m.classes.includes(className)))
      .map(m => m.teacherId);

    if (eligibleTeachers.length === 0) {
      // Check if preferred teacher is set
      if (req.preferredTeacherId) {
        eligibleTeachers.push(req.preferredTeacherId);
      } else {
        return {
          success: false,
          error: `Cannot generate timetable: No eligible teacher mapped for subject "${req.subjectId.name}". Please assign a qualified teacher to this subject in Subject-Teacher Mapping.`
        };
      }
    }
    subjectTeachersMap.set(subIdStr, eligibleTeachers);
  }

  // 5. Gather busy slots for all teachers across the ENTIRE school in this academic year
  // Exclude current timetable's existing entries (since we are regenerating it)
  const existingOtherEntries = await TimetableEntry.find({
    academicYear,
    timetableId: { $ne: timetable._id },
    isBreak: false,
    teacherId: { $ne: null }
  }).lean();

  const teacherBusyMap = new Map(); // `${teacherId}::${day}::${periodNumber}` -> entry
  for (const entry of existingOtherEntries) {
    const key = `${entry.teacherId.toString()}::${entry.day}::${entry.periodNumber}`;
    teacherBusyMap.set(key, entry);
  }

  // Fetch teacher unavailabilities
  const allTeacherAvailabilities = await TeacherAvailability.find({ academicYear }).lean();
  const teacherUnavailableMap = new Map();
  for (const tav of allTeacherAvailabilities) {
    if (tav.unavailableSlots) {
      for (const slot of tav.unavailableSlots) {
        const key = `${tav.teacherId.toString()}::${slot.day}::${slot.periodNumber}`;
        teacherUnavailableMap.set(key, slot.reason || 'Unavailable');
      }
    }
  }

  // 6. Build the list of all teaching slots to fill
  // Structure: { day, periodNumber, periodConfig }
  const slotsToFill = [];
  for (const day of workingDays) {
    for (const p of teachingPeriods) {
      slotsToFill.push({
        day,
        periodNumber: p.periodNumber,
        periodConfig: p
      });
    }
  }

  // 7. Expand requirements into unit periods:
  // e.g., Maths (6) -> 6 tokens of Maths
  // Sort subjects: High priority first, then Medium, then Low
  const priorityWeight = { High: 3, Medium: 2, Low: 1 };
  const sortedRequirements = requirements.slice().sort((a, b) => {
    const pwA = priorityWeight[a.priority] || 2;
    const pwB = priorityWeight[b.priority] || 2;
    if (pwB !== pwA) return pwB - pwA;
    return (b.weeklyPeriods || 0) - (a.weeklyPeriods || 0);
  });

  const subjectTokens = [];
  for (const req of sortedRequirements) {
    for (let i = 0; i < req.weeklyPeriods; i++) {
      subjectTokens.push({
        subjectId: req.subjectId._id,
        subjectName: req.subjectId.name,
        subjectCode: req.subjectId.code,
        category: req.subjectId.category,
        priority: req.priority,
        maxPerDay: req.maxPerDay || 2,
        preferredTeacherId: req.preferredTeacherId?._id || null
      });
    }
  }

  // 8. Solvers: Backtracking constraint satisfaction
  // Grid: day -> periodNumber -> allocation
  const scheduleGrid = new Map(); // `${day}::${periodNumber}` -> { subject, teacher }
  const teacherDailyCount = new Map(); // `${teacherId}::${day}` -> count
  const subjectDailyCount = new Map(); // `${subjectId}::${day}` -> count
  const teacherSlotMap = new Map(); // `${teacherId}::${day}::${periodNumber}` -> true (for newly assigned in this run)

  let solutionFound = false;
  let iterations = 0;
  const MAX_ITERATIONS = 20000;
  let failureReason = '';

  const solve = (tokenIndex) => {
    if (tokenIndex >= subjectTokens.length) {
      return true; // All subject periods assigned!
    }

    iterations++;
    if (iterations > MAX_ITERATIONS) {
      failureReason = 'Search space limit reached due to tight teacher availability and constraints across classes.';
      return false;
    }

    const token = subjectTokens[tokenIndex];
    const eligibleTeachers = subjectTeachersMap.get(token.subjectId.toString()) || [];

    // Prioritize slots based on subject category:
    // Core/High priority subjects: distribute across different days, prefer earlier periods (morning)
    // Activities/PE/Labs: prefer afternoon periods
    const candidateSlots = slotsToFill.slice().sort((a, b) => {
      const aFilled = scheduleGrid.has(`${a.day}::${a.periodNumber}`);
      const bFilled = scheduleGrid.has(`${b.day}::${b.periodNumber}`);
      if (aFilled !== bFilled) return aFilled ? 1 : -1;

      // Prefer day with fewer periods of this subject
      const aSubCount = subjectDailyCount.get(`${token.subjectId}::${a.day}`) || 0;
      const bSubCount = subjectDailyCount.get(`${token.subjectId}::${b.day}`) || 0;
      if (aSubCount !== bSubCount) return aSubCount - bSubCount;

      // Period positioning heuristic
      if (token.priority === 'High' || token.category === 'Core') {
        return a.periodNumber - b.periodNumber; // morning first
      } else if (token.category === 'Activity' || token.category === 'Science/Lab') {
        return b.periodNumber - a.periodNumber; // afternoon preferred
      }
      return 0;
    });

    for (const slot of candidateSlots) {
      const slotKey = `${slot.day}::${slot.periodNumber}`;
      if (scheduleGrid.has(slotKey)) continue;

      // Check max per day for this subject in this class
      const curSubDayCount = subjectDailyCount.get(`${token.subjectId}::${slot.day}`) || 0;
      if (curSubDayCount >= token.maxPerDay) continue;

      // Try each eligible teacher
      // Sort teachers: preferred teacher first, then teacher with least current load
      const teachersToTry = eligibleTeachers.slice().sort((t1, t2) => {
        if (token.preferredTeacherId) {
          if (t1._id.equals(token.preferredTeacherId)) return -1;
          if (t2._id.equals(token.preferredTeacherId)) return 1;
        }
        const load1 = teacherDailyCount.get(`${t1._id}::${slot.day}`) || 0;
        const load2 = teacherDailyCount.get(`${t2._id}::${slot.day}`) || 0;
        return load1 - load2;
      });

      for (const teacher of teachersToTry) {
        const teacherIdStr = teacher._id.toString();
        const teacherSlotKey = `${teacherIdStr}::${slot.day}::${slot.periodNumber}`;

        // Rule 1: Teacher Conflict Prevention (Check other classes)
        if (teacherBusyMap.has(teacherSlotKey)) {
          continue; // Teacher busy in another class
        }

        // Rule 1b: Teacher assigned already in this generator run
        if (teacherSlotMap.has(teacherSlotKey)) {
          continue;
        }

        // Rule 5: Teacher Availability
        if (teacherUnavailableMap.has(teacherSlotKey)) {
          continue;
        }

        // Avoid excessive consecutive periods for the same teacher (max 2 consecutive)
        const prevSlotTeacher = scheduleGrid.get(`${slot.day}::${slot.periodNumber - 1}`)?.teacherId;
        const prevPrevSlotTeacher = scheduleGrid.get(`${slot.day}::${slot.periodNumber - 2}`)?.teacherId;
        if (
          prevSlotTeacher &&
          prevPrevSlotTeacher &&
          prevSlotTeacher.equals(teacher._id) &&
          prevPrevSlotTeacher.equals(teacher._id)
        ) {
          continue; // Skip 3 in a row
        }

        // Assign
        scheduleGrid.set(slotKey, {
          subjectId: token.subjectId,
          subjectName: token.subjectName,
          teacherId: teacher._id,
          teacherName: teacher.name,
          day: slot.day,
          periodNumber: slot.periodNumber,
          periodConfig: slot.periodConfig
        });

        teacherSlotMap.set(teacherSlotKey, true);
        subjectDailyCount.set(`${token.subjectId}::${slot.day}`, curSubDayCount + 1);
        const curTeachDayCount = teacherDailyCount.get(`${teacherIdStr}::${slot.day}`) || 0;
        teacherDailyCount.set(`${teacherIdStr}::${slot.day}`, curTeachDayCount + 1);

        if (solve(tokenIndex + 1)) {
          return true;
        }

        // Backtrack
        scheduleGrid.delete(slotKey);
        teacherSlotMap.delete(teacherSlotKey);
        subjectDailyCount.set(`${token.subjectId}::${slot.day}`, curSubDayCount);
        teacherDailyCount.set(`${teacherIdStr}::${slot.day}`, curTeachDayCount);
      }
    }

    if (!failureReason) {
      failureReason = `Could not find an unconflicted period for subject "${token.subjectName}". All eligible teachers are either booked in other classes, unavailable, or exceed daily limits.`;
    }
    return false;
  };

  solutionFound = solve(0);

  if (!solutionFound) {
    return {
      success: false,
      error: `Automatic Generation Failed: ${failureReason || 'A clash-free schedule could not be satisfied with the current teacher workloads and constraints.'}`
    };
  }

  // 9. Wipe existing entries for this timetable and save new generated entries!
  await TimetableEntry.deleteMany({ timetableId: timetable._id });

  const entriesToInsert = [];

  // Add break and lunch entries
  for (const day of workingDays) {
    for (const brk of breakPeriods) {
      entriesToInsert.push({
        timetableId: timetable._id,
        academicYear,
        classId,
        className,
        sectionId: sectionId || null,
        sectionName: sectionName || '',
        day,
        periodNumber: brk.periodNumber,
        startTime: brk.startTime || '',
        endTime: brk.endTime || '',
        isBreak: true,
        breakTitle: brk.name || 'Break',
        subjectId: null,
        subjectName: '',
        teacherId: null,
        teacherName: '',
        room: ''
      });
    }
  }

  // Add scheduled teaching entries
  for (const [slotKey, alloc] of scheduleGrid.entries()) {
    entriesToInsert.push({
      timetableId: timetable._id,
      academicYear,
      classId,
      className,
      sectionId: sectionId || null,
      sectionName: sectionName || '',
      day: alloc.day,
      periodNumber: alloc.periodNumber,
      startTime: alloc.periodConfig.startTime || '',
      endTime: alloc.periodConfig.endTime || '',
      isBreak: false,
      breakTitle: '',
      subjectId: alloc.subjectId,
      subjectName: alloc.subjectName,
      teacherId: alloc.teacherId,
      teacherName: alloc.teacherName,
      room: ''
    });
  }

  await TimetableEntry.insertMany(entriesToInsert);

  timetable.updatedBy = userId;
  timetable.status = 'Draft';
  timetable.isPublished = false;
  await timetable.save();

  return {
    success: true,
    message: `Timetable generated successfully for Class ${className}${sectionName ? ' - Section ' + sectionName : ''}. ${scheduleGrid.size} teaching periods assigned without clashes.`,
    timetableId: timetable._id,
    assignedCount: scheduleGrid.size,
    totalSlots: totalTeachingSlots
  };
};
