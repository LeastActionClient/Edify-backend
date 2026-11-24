import {
  TimetableEntry,
  Timetable,
  Teacher,
  Subject,
  TeacherSubject,
  TeacherAvailability,
  SubjectRequirement,
  TimetableConfig
} from '../models/index.js';

/**
 * Validates a single timetable entry allocation against all business rules.
 * Throws or returns an error string if invalid; returns null if valid.
 */
export const validateTimetableEntry = async ({
  timetableId,
  academicYear,
  classId,
  className,
  sectionId,
  sectionName,
  day,
  periodNumber,
  subjectId,
  teacherId,
  isBreak = false,
  breakTitle = '',
  entryId = null // if updating existing entry
}) => {
  // If it's a break/lunch slot, no teacher or subject validation needed
  if (isBreak) {
    // Just ensure no class clash
    const classConflict = await TimetableEntry.findOne({
      timetableId,
      day,
      periodNumber,
      ...(entryId ? { _id: { $ne: entryId } } : {})
    });
    if (classConflict && !classConflict._id.equals(entryId)) {
      return `Class ${className}${sectionName ? ' - Section ' + sectionName : ''} already has an entry at ${day} Period ${periodNumber}.`;
    }
    return null;
  }

  // 1. Mandatory subject and teacher check for non-break teaching periods
  if (!subjectId) {
    return 'Subject is required for teaching period.';
  }
  if (!teacherId) {
    return 'Teacher is required for teaching period.';
  }

  const [teacher, subject] = await Promise.all([
    Teacher.findById(teacherId).lean(),
    Subject.findById(subjectId).lean()
  ]);

  if (!teacher) {
    return 'Selected teacher not found.';
  }
  if (!subject) {
    return 'Selected subject not found.';
  }

  // 2. RULE 1: Teacher Conflict Prevention (MOST IMPORTANT BUSINESS RULE)
  // A teacher cannot be assigned to more than one class/section on the same day and period.
  const teacherClash = await TimetableEntry.findOne({
    academicYear,
    day,
    periodNumber,
    teacherId,
    ...(entryId ? { _id: { $ne: entryId } } : {})
  }).lean();

  if (teacherClash) {
    const clashClass = teacherClash.className || 'another class';
    const clashSection = teacherClash.sectionName ? ` - Section ${teacherClash.sectionName}` : '';
    return `Teacher ${teacher.name} is already assigned to Class ${clashClass}${clashSection} during ${day} Period ${periodNumber}. Please select another teacher or period.`;
  }

  // 3. RULE 2: Class Conflict Prevention
  // A class cannot have two different subjects or teachers in the same period.
  const classClash = await TimetableEntry.findOne({
    timetableId,
    day,
    periodNumber,
    ...(entryId ? { _id: { $ne: entryId } } : {})
  }).lean();

  if (classClash) {
    return `Class ${className}${sectionName ? ' - Section ' + sectionName : ''} already has ${classClash.subjectName || 'a subject'} scheduled for ${day} Period ${periodNumber}.`;
  }

  // 4. RULE 3: Subject Eligibility
  // Only assign teachers who are mapped to the respective subject.
  const mapping = await TeacherSubject.findOne({ teacherId, subjectId }).lean();
  if (!mapping) {
    return `Teacher ${teacher.name} is not eligible or mapped to teach subject "${subject.name}". Please map this teacher to the subject in Settings.`;
  }
  if (mapping.classes && mapping.classes.length > 0 && !mapping.classes.includes(className)) {
    return `Teacher ${teacher.name} is mapped to teach "${subject.name}" only for classes: ${mapping.classes.join(', ')}.`;
  }

  // 5. RULE 5: Teacher Availability & Break Periods
  const availability = await TeacherAvailability.findOne({ teacherId, academicYear }).lean();
  if (availability && availability.unavailableSlots && availability.unavailableSlots.length > 0) {
    const isUnavailable = availability.unavailableSlots.some(
      (slot) => slot.day === day && Number(slot.periodNumber) === Number(periodNumber)
    );
    if (isUnavailable) {
      const slot = availability.unavailableSlots.find(
        (s) => s.day === day && Number(s.periodNumber) === Number(periodNumber)
      );
      return `Teacher ${teacher.name} is marked as unavailable during ${day} Period ${periodNumber} (${slot?.reason || 'Leave / Unavailable'}).`;
    }
  }

  // Check Teacher Daily Max Periods
  if (availability?.maxDailyPeriods) {
    const dailyCount = await TimetableEntry.countDocuments({
      academicYear,
      teacherId,
      day,
      isBreak: false,
      ...(entryId ? { _id: { $ne: entryId } } : {})
    });
    if (dailyCount >= availability.maxDailyPeriods) {
      return `Teacher ${teacher.name} has already reached the maximum daily limit of ${availability.maxDailyPeriods} periods on ${day}.`;
    }
  }

  // 6. RULE 4: Weekly Workload limit for Teacher
  const maxWeekly = availability?.maxWeeklyPeriods || mapping.maxWeeklyPeriods || 30;
  const currentTeacherWeeklyCount = await TimetableEntry.countDocuments({
    academicYear,
    teacherId,
    isBreak: false,
    ...(entryId ? { _id: { $ne: entryId } } : {})
  });
  if (currentTeacherWeeklyCount >= maxWeekly) {
    return `Teacher ${teacher.name} has reached the maximum weekly workload limit (${maxWeekly} periods). Currently assigned: ${currentTeacherWeeklyCount} periods.`;
  }

  return null; // Valid!
};

/**
 * Scans all timetable entries in an academic year for any potential teacher or class clashes.
 * Returns array of conflict descriptors.
 */
export const scanForConflicts = async (academicYear) => {
  const entries = await TimetableEntry.find({
    academicYear,
    isBreak: false,
    teacherId: { $ne: null }
  }).lean();

  const teacherMap = new Map();
  const conflicts = [];

  for (const entry of entries) {
    const key = `${entry.day}::${entry.periodNumber}::${entry.teacherId.toString()}`;
    if (teacherMap.has(key)) {
      const existing = teacherMap.get(key);
      conflicts.push({
        type: 'TEACHER_CLASH',
        teacherId: entry.teacherId,
        teacherName: entry.teacherName,
        day: entry.day,
        periodNumber: entry.periodNumber,
        entryA: {
          id: existing._id,
          className: existing.className,
          sectionName: existing.sectionName,
          subjectName: existing.subjectName
        },
        entryB: {
          id: entry._id,
          className: entry.className,
          sectionName: entry.sectionName,
          subjectName: entry.subjectName
        },
        message: `Teacher ${entry.teacherName} is assigned to both ${existing.className}${existing.sectionName ? ' (' + existing.sectionName + ')' : ''} and ${entry.className}${entry.sectionName ? ' (' + entry.sectionName + ')' : ''} during ${entry.day} Period ${entry.periodNumber}.`
      });
    } else {
      teacherMap.set(key, entry);
    }
  }

  return conflicts;
};
