import '../config/db.js';
import connectDB from '../config/db.js';
import mongoose from 'mongoose';
import {
  Subject,
  Teacher,
  TeacherSubject,
  TeacherAvailability,
  TimetableConfig,
  SubjectRequirement,
  Timetable,
  TimetableEntry,
  Class,
  AcademicYear
} from '../models/index.js';
import { validateTimetableEntry, scanForConflicts } from '../services/timetableValidationService.js';
import { generateClassTimetable } from '../services/timetableGeneratorService.js';

async function runTests() {
  console.log('--- STARTING COMPREHENSIVE TIMETABLE TEST SUITE ---');
  await connectDB();

  const testYear = '2026–2027';

  // 1. Clean previous test artifacts
  console.log('1. Cleaning test data...');
  await TimetableEntry.deleteMany({ academicYear: testYear });
  await Timetable.deleteMany({ academicYear: testYear });
  await SubjectRequirement.deleteMany({ academicYear: testYear });
  await TeacherSubject.deleteMany({});
  await TeacherAvailability.deleteMany({ academicYear: testYear });
  await Subject.deleteMany({ name: { $in: ['Test Math', 'Test English', 'Test Science', 'Test PE'] } });
  await Teacher.deleteMany({ teacherId: { $in: ['T_TEST_01', 'T_TEST_02', 'T_TEST_03'] } });
  await Class.deleteMany({ name: { $in: ['TEST_CLASS_A', 'TEST_CLASS_B'] } });

  // 2. Create Test Classes
  console.log('2. Creating test classes...');
  const classA = await Class.create({ name: 'TEST_CLASS_A' });
  const classB = await Class.create({ name: 'TEST_CLASS_B' });

  // 3. Create Test Teachers
  console.log('3. Creating test teachers...');
  const teacherRavi = await Teacher.create({
    teacherId: 'T_TEST_01',
    name: 'Teacher Ravi',
    designation: 'Senior Math Teacher',
    phoneNumber: '9876543210',
    address: 'Lotus City'
  });

  const teacherPriya = await Teacher.create({
    teacherId: 'T_TEST_02',
    name: 'Teacher Priya',
    designation: 'English Faculty',
    phoneNumber: '9876543211',
    address: 'Lotus City'
  });

  const teacherKumar = await Teacher.create({
    teacherId: 'T_TEST_03',
    name: 'Teacher Kumar',
    designation: 'Science Faculty',
    phoneNumber: '9876543212',
    address: 'Lotus City'
  });

  // 4. Create Test Subjects
  console.log('4. Creating test subjects...');
  const subMath = await Subject.create({
    name: 'Test Math',
    code: 'TMATH',
    category: 'Core',
    color: '#EF4444',
    defaultWeeklyPeriods: 6
  });

  const subEng = await Subject.create({
    name: 'Test English',
    code: 'TENG',
    category: 'Language',
    color: '#3B82F6',
    defaultWeeklyPeriods: 6
  });

  const subSci = await Subject.create({
    name: 'Test Science',
    code: 'TSCI',
    category: 'Core',
    color: '#8B5CF6',
    defaultWeeklyPeriods: 5
  });

  // 5. Create Teacher-Subject Mappings (Subject Eligibility)
  console.log('5. Creating teacher-subject mappings...');
  await TeacherSubject.create({ teacherId: teacherRavi._id, subjectId: subMath._id, maxWeeklyPeriods: 25 });
  await TeacherSubject.create({ teacherId: teacherPriya._id, subjectId: subEng._id, maxWeeklyPeriods: 25 });
  await TeacherSubject.create({ teacherId: teacherKumar._id, subjectId: subSci._id, maxWeeklyPeriods: 25 });

  // 6. Create Timetable Config
  console.log('6. Configuring period slots...');
  const periods = [
    { periodNumber: 1, name: 'Period 1', startTime: '09:00', endTime: '09:45', type: 'teaching', isBreak: false },
    { periodNumber: 2, name: 'Period 2', startTime: '09:45', endTime: '10:30', type: 'teaching', isBreak: false },
    { periodNumber: 3, name: 'Break', startTime: '10:30', endTime: '10:45', type: 'break', isBreak: true },
    { periodNumber: 4, name: 'Period 3', startTime: '10:45', endTime: '11:30', type: 'teaching', isBreak: false },
    { periodNumber: 5, name: 'Period 4', startTime: '11:30', endTime: '12:15', type: 'teaching', isBreak: false }
  ];

  await TimetableConfig.findOneAndUpdate(
    { academicYear: testYear, classId: null },
    {
      className: 'All',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      periods
    },
    { upsert: true }
  );

  // 7. Create Timetables
  console.log('7. Creating timetable headers...');
  const ttA = await Timetable.create({
    academicYear: testYear,
    classId: classA._id,
    className: classA.name,
    status: 'Draft'
  });

  const ttB = await Timetable.create({
    academicYear: testYear,
    classId: classB._id,
    className: classB.name,
    status: 'Draft'
  });

  // ---------------------------------------------------------
  // TEST: MANUAL ALLOCATION & BUSINESS RULES VALIDATION
  // ---------------------------------------------------------
  console.log('\n--- TESTING RULE 1: TEACHER CONFLICT PREVENTION ---');
  // Assign Teacher Ravi to Class A on Monday Period 1 (Valid)
  const validErr1 = await validateTimetableEntry({
    timetableId: ttA._id,
    academicYear: testYear,
    classId: classA._id,
    className: classA.name,
    day: 'Monday',
    periodNumber: 1,
    subjectId: subMath._id,
    teacherId: teacherRavi._id
  });
  console.log('Valid assignment 1 validation result:', validErr1);
  if (validErr1 !== null) throw new Error('Expected null for valid assignment');

  // Save the entry for Class A
  await TimetableEntry.create({
    timetableId: ttA._id,
    academicYear: testYear,
    classId: classA._id,
    className: classA.name,
    day: 'Monday',
    periodNumber: 1,
    subjectId: subMath._id,
    subjectName: subMath.name,
    teacherId: teacherRavi._id,
    teacherName: teacherRavi.name
  });
  console.log('Saved: Monday Period 1: Teacher Ravi -> Class A (Math)');

  // Now try to assign Teacher Ravi to Class B on Monday Period 1 (MUST BE REJECTED)
  const clashErr = await validateTimetableEntry({
    timetableId: ttB._id,
    academicYear: testYear,
    classId: classB._id,
    className: classB.name,
    day: 'Monday',
    periodNumber: 1,
    subjectId: subMath._id,
    teacherId: teacherRavi._id
  });
  console.log('Clash attempt validation result:', clashErr);
  if (!clashErr || !clashErr.includes('already assigned to Class TEST_CLASS_A during Monday Period 1')) {
    throw new Error('FAIL: Teacher clash was NOT properly caught and rejected!');
  }
  console.log('PASS: Rule 1 (Teacher Conflict Prevention) successfully rejected clash with descriptive message!');

  // Now test DB-LEVEL UNIQUE CONSTRAINT PROTECTION:
  // If someone attempts a direct database insert bypassing validation, MongoDB index must reject it!
  console.log('\n--- TESTING DATABASE-LEVEL UNIQUE CONSTRAINT PROTECTION ---');
  let dbIndexTriggered = false;
  try {
    await TimetableEntry.create({
      timetableId: ttB._id,
      academicYear: testYear,
      classId: classB._id,
      className: classB.name,
      day: 'Monday',
      periodNumber: 1,
      subjectId: subMath._id,
      teacherId: teacherRavi._id
    });
  } catch (err) {
    if (err.code === 11000) {
      dbIndexTriggered = true;
      console.log('PASS: Database unique index successfully rejected duplicate teacher allocation with E11000!');
    } else {
      console.error('Unexpected error:', err);
    }
  }
  if (!dbIndexTriggered) {
    throw new Error('FAIL: Database index did not prevent duplicate teacher allocation!');
  }

  // ---------------------------------------------------------
  // TEST: RULE 2: CLASS CONFLICT PREVENTION
  // ---------------------------------------------------------
  console.log('\n--- TESTING RULE 2: CLASS CONFLICT PREVENTION ---');
  const classClashErr = await validateTimetableEntry({
    timetableId: ttA._id,
    academicYear: testYear,
    classId: classA._id,
    className: classA.name,
    day: 'Monday',
    periodNumber: 1,
    subjectId: subEng._id,
    teacherId: teacherPriya._id
  });
  console.log('Class clash validation result:', classClashErr);
  if (!classClashErr || !classClashErr.includes('already has Test Math scheduled for Monday Period 1')) {
    throw new Error('FAIL: Class clash was NOT properly caught!');
  }
  console.log('PASS: Rule 2 (Class Conflict Prevention) verified!');

  // ---------------------------------------------------------
  // TEST: RULE 3: SUBJECT ELIGIBILITY
  // ---------------------------------------------------------
  console.log('\n--- TESTING RULE 3: SUBJECT ELIGIBILITY ---');
  // Teacher Kumar is only mapped to Science, not English
  const ineligibilityErr = await validateTimetableEntry({
    timetableId: ttB._id,
    academicYear: testYear,
    classId: classB._id,
    className: classB.name,
    day: 'Monday',
    periodNumber: 2,
    subjectId: subEng._id,
    teacherId: teacherKumar._id
  });
  console.log('Subject ineligibility result:', ineligibilityErr);
  if (!ineligibilityErr || !ineligibilityErr.includes('not eligible or mapped to teach subject "Test English"')) {
    throw new Error('FAIL: Subject ineligibility was NOT properly caught!');
  }
  console.log('PASS: Rule 3 (Subject Eligibility) verified!');

  // ---------------------------------------------------------
  // TEST: RULE 5: TEACHER AVAILABILITY
  // ---------------------------------------------------------
  console.log('\n--- TESTING RULE 5: TEACHER AVAILABILITY ---');
  await TeacherAvailability.create({
    teacherId: teacherPriya._id,
    academicYear: testYear,
    unavailableSlots: [{ day: 'Tuesday', periodNumber: 2, reason: 'Medical Appointment' }],
    maxDailyPeriods: 4,
    maxWeeklyPeriods: 20
  });

  const unavailErr = await validateTimetableEntry({
    timetableId: ttB._id,
    academicYear: testYear,
    classId: classB._id,
    className: classB.name,
    day: 'Tuesday',
    periodNumber: 2,
    subjectId: subEng._id,
    teacherId: teacherPriya._id
  });
  console.log('Teacher unavailability result:', unavailErr);
  if (!unavailErr || !unavailErr.includes('marked as unavailable during Tuesday Period 2 (Medical Appointment)')) {
    throw new Error('FAIL: Teacher unavailability was NOT properly caught!');
  }
  console.log('PASS: Rule 5 (Teacher Availability) verified!');

  // ---------------------------------------------------------
  // TEST: AUTOMATIC TIMETABLE GENERATION
  // ---------------------------------------------------------
  console.log('\n--- TESTING AUTOMATIC TIMETABLE GENERATION ---');
  // Setup Subject Requirements for Class B
  await SubjectRequirement.create({
    academicYear: testYear,
    classId: classB._id,
    className: classB.name,
    subjectId: subMath._id,
    weeklyPeriods: 5,
    priority: 'High',
    maxPerDay: 1
  });
  await SubjectRequirement.create({
    academicYear: testYear,
    classId: classB._id,
    className: classB.name,
    subjectId: subEng._id,
    weeklyPeriods: 5,
    priority: 'High',
    maxPerDay: 1
  });
  await SubjectRequirement.create({
    academicYear: testYear,
    classId: classB._id,
    className: classB.name,
    subjectId: subSci._id,
    weeklyPeriods: 5,
    priority: 'Medium',
    maxPerDay: 1
  });

  const genResult = await generateClassTimetable({
    academicYear: testYear,
    classId: classB._id,
    className: classB.name
  });
  console.log('Generation result:', genResult);
  if (!genResult.success) {
    throw new Error(`FAIL: Generator failed: ${genResult.error}`);
  }

  // Verify that Class B did NOT allocate Teacher Ravi during Monday Period 1 (where he was already booked for Class A)
  const classBEntryMon1 = await TimetableEntry.findOne({
    timetableId: ttB._id,
    day: 'Monday',
    periodNumber: 1
  }).lean();
  console.log('Class B Monday Period 1 allocation:', classBEntryMon1);
  if (classBEntryMon1 && classBEntryMon1.teacherId?.toString() === teacherRavi._id.toString()) {
    throw new Error('FAIL: Generator assigned Teacher Ravi on Monday Period 1 despite clash with Class A!');
  }
  console.log('PASS: Generator respected teacher clashes and scheduled an alternative teacher!');

  // Verify full conflict scan across entire school is 0!
  const finalConflicts = await scanForConflicts(testYear);
  console.log('Full school conflicts count:', finalConflicts.length);
  if (finalConflicts.length > 0) {
    console.error('Conflicts found:', finalConflicts);
    throw new Error('FAIL: Conflicts detected after generation!');
  }
  console.log('PASS: 0 conflicts across the entire school!');

  // ---------------------------------------------------------
  // CLEANUP TEST DATA
  // ---------------------------------------------------------
  console.log('\n--- CLEANING UP TEST DATA ---');
  await TimetableEntry.deleteMany({ academicYear: testYear });
  await Timetable.deleteMany({ academicYear: testYear });
  await SubjectRequirement.deleteMany({ academicYear: testYear });
  await TeacherSubject.deleteMany({});
  await TeacherAvailability.deleteMany({ academicYear: testYear });
  await Subject.deleteMany({ name: { $in: ['Test Math', 'Test English', 'Test Science', 'Test PE'] } });
  await Teacher.deleteMany({ teacherId: { $in: ['T_TEST_01', 'T_TEST_02', 'T_TEST_03'] } });
  await Class.deleteMany({ name: { $in: ['TEST_CLASS_A', 'TEST_CLASS_B'] } });

  console.log('\n>>> ALL BACKEND & DATABASE TESTS PASSED SUCCESSFULLY! <<<\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
