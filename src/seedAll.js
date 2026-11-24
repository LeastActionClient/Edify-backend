import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import {
  User,
  AcademicYear,
  Class,
  FeeCategory,
  Settings,
  AccountSetting,
  AdmissionSequence,
  Subject,
  TimetableConfig,
  Teacher,
  TeacherSubject,
  ProgressCardExam
} from './models/index.js';

dotenv.config();

async function seedUsers() {
  console.log('[1/9] Seeding Users...');
  const superAdminUsername = process.env.SUPERADMIN_USERNAME || 'superadmin';
  const superAdminPassword = process.env.SUPERADMIN_PASSWORD || 'admin123';
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  const superAdminHash = await bcrypt.hash(superAdminPassword, 10);
  await User.findOneAndUpdate(
    { username: { $regex: new RegExp(`^${superAdminUsername}$`, 'i') } },
    {
      $set: {
        username: superAdminUsername,
        password: superAdminHash,
        role: 'SUPER_ADMIN',
        isActive: true,
        lastActivity: new Date()
      }
    },
    { upsert: true, new: true }
  );
  console.log(`  ✓ Super Admin ready: ${superAdminUsername}`);

  const adminHash = await bcrypt.hash(adminPassword, 10);
  await User.findOneAndUpdate(
    { username: { $regex: new RegExp(`^${adminUsername}$`, 'i') } },
    {
      $set: {
        username: adminUsername,
        password: adminHash,
        role: 'ADMIN',
        isActive: true,
        lastActivity: new Date()
      }
    },
    { upsert: true, new: true }
  );
  console.log(`  ✓ Admin ready: ${adminUsername}`);
}

async function seedAcademicYear() {
  console.log('[2/9] Seeding Academic Year...');
  const activeYear = await AcademicYear.findOne({ status: 'Active' });
  if (!activeYear) {
    const created = await AcademicYear.create({
      year: '2026–2027',
      status: 'Active'
    });
    console.log(`  ✓ Created Active Academic Year: ${created.year}`);
    return created.year;
  }
  console.log(`  ✓ Active Academic Year already present: ${activeYear.year}`);
  return activeYear.year;
}

async function seedSettings() {
  console.log('[3/9] Seeding Settings & Sequences...');
  await Settings.findOneAndUpdate(
    { _id: 'global' },
    {
      $setOnInsert: {
        _id: 'global',
        applicationFeeAmount: '300',
        nextApplicationNo: 'AC-001'
      }
    },
    { upsert: true, new: true }
  );
  console.log('  ✓ Global settings configured');

  await AccountSetting.findOneAndUpdate(
    { key: 'primary' },
    { $setOnInsert: { key: 'primary', totalAmount: 0 } },
    { upsert: true }
  );
  console.log('  ✓ Account primary settings configured');

  await AdmissionSequence.findOneAndUpdate(
    { _id: 'student-admission-number' },
    {
      $setOnInsert: {
        _id: 'student-admission-number',
        prefix: 'ADM',
        padding: 4,
        value: 0,
        sourceAdmissionNumber: ''
      }
    },
    { upsert: true }
  );
  console.log('  ✓ Admission sequence configured');
}

async function seedClasses() {
  console.log('[4/9] Seeding Standard Classes...');
  const defaultClasses = [
    'PRE-KG',
    'LKG',
    'UKG',
    'GRADE 1',
    'GRADE 2',
    'GRADE 3',
    'GRADE 4',
    'GRADE 5'
  ];

  for (const className of defaultClasses) {
    await Class.findOneAndUpdate(
      { name: className },
      { $setOnInsert: { name: className } },
      { upsert: true, new: true }
    );
  }
  console.log(`  ✓ Ensured classes: ${defaultClasses.join(', ')}`);
}

async function seedFeeCategories() {
  console.log('[5/9] Seeding Default Fee Categories...');
  const defaultCategories = [
    { name: 'Term 1', isEnabled: true, mandatory: true },
    { name: 'Term 2', isEnabled: true, mandatory: false },
    { name: 'Tuition Fee', isEnabled: true, mandatory: false }
  ];

  for (const cat of defaultCategories) {
    await FeeCategory.findOneAndUpdate(
      { name: cat.name },
      {
        $setOnInsert: {
          name: cat.name,
          isEnabled: cat.isEnabled,
          mandatory: cat.mandatory,
          isStockItem: false,
          currentStock: 0,
          topStock: 0,
          bottomStock: 0
        }
      },
      { upsert: true, new: true }
    );
  }
  console.log('  ✓ Fee categories initialized');
}

async function seedSubjectsAndTimetable(activeYear) {
  console.log('[6/9] Seeding Default Subjects & Timetable Config...');
  const defaults = [
    { name: 'Tamil', code: 'TAM', category: 'Language', color: '#10B981', defaultWeeklyPeriods: 6 },
    { name: 'English', code: 'ENG', category: 'Language', color: '#3B82F6', defaultWeeklyPeriods: 6 },
    { name: 'Mathematics', code: 'MATH', category: 'Core', color: '#EF4444', defaultWeeklyPeriods: 7 },
    { name: 'Science', code: 'SCI', category: 'Core', color: '#8B5CF6', defaultWeeklyPeriods: 6 },
    { name: 'Social Science', code: 'SOC', category: 'Core', color: '#F59E0B', defaultWeeklyPeriods: 5 },
    { name: 'Hindi', code: 'HIN', category: 'Language', color: '#EC4899', defaultWeeklyPeriods: 3 },
    { name: 'Computer Science', code: 'CS', category: 'Science/Lab', color: '#06B6D4', defaultWeeklyPeriods: 2 },
    { name: 'Physical Education', code: 'PE', category: 'Activity', color: '#14B8A6', defaultWeeklyPeriods: 2 },
    { name: 'Art & Craft', code: 'ART', category: 'Activity', color: '#F97316', defaultWeeklyPeriods: 1 },
    { name: 'Moral Science / GK', code: 'GK', category: 'General', color: '#6366F1', defaultWeeklyPeriods: 1 }
  ];

  for (const item of defaults) {
    const exists = await Subject.findOne({
      $or: [{ name: item.name }, { code: item.code }]
    });
    if (!exists) {
      await Subject.create(item);
    }
  }
  console.log('  ✓ Subjects initialized');

  let config = await TimetableConfig.findOne({ academicYear: activeYear, classId: null });
  if (!config) {
    const defaultPeriods = [
      { periodNumber: 1, name: 'Period 1', startTime: '09:00 AM', endTime: '09:45 AM', type: 'teaching', isBreak: false },
      { periodNumber: 2, name: 'Period 2', startTime: '09:45 AM', endTime: '10:30 AM', type: 'teaching', isBreak: false },
      { periodNumber: 3, name: 'Morning Break', startTime: '10:30 AM', endTime: '10:45 AM', type: 'break', isBreak: true },
      { periodNumber: 4, name: 'Period 3', startTime: '10:45 AM', endTime: '11:30 AM', type: 'teaching', isBreak: false },
      { periodNumber: 5, name: 'Period 4', startTime: '11:30 AM', endTime: '12:15 PM', type: 'teaching', isBreak: false },
      { periodNumber: 6, name: 'Lunch Break', startTime: '12:15 PM', endTime: '01:00 PM', type: 'lunch', isBreak: true },
      { periodNumber: 7, name: 'Period 5', startTime: '01:00 PM', endTime: '01:45 PM', type: 'teaching', isBreak: false },
      { periodNumber: 8, name: 'Period 6', startTime: '01:45 PM', endTime: '02:30 PM', type: 'teaching', isBreak: false },
      { periodNumber: 9, name: 'Period 7', startTime: '02:30 PM', endTime: '03:15 PM', type: 'teaching', isBreak: false },
      { periodNumber: 10, name: 'Period 8', startTime: '03:15 PM', endTime: '04:00 PM', type: 'teaching', isBreak: false }
    ];
    await TimetableConfig.create({
      academicYear: activeYear,
      classId: null,
      className: 'All',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      periods: defaultPeriods
    });
    console.log('  ✓ Timetable default config created');
  } else {
    console.log('  ✓ Timetable config already exists');
  }
}

async function seedTeachers() {
  console.log('[7/9] Seeding Initial Teachers & Subject Mappings...');
  const teacherCount = await Teacher.countDocuments();
  if (teacherCount === 0) {
    const initialTeachers = [
      { teacherId: 'T101', name: 'Ravi Kumar', designation: 'Senior Mathematics Teacher', phoneNumber: '9840112233', address: 'Tiruvannamalai' },
      { teacherId: 'T102', name: 'Priya Dharshini', designation: 'English Department Head', phoneNumber: '9840112234', address: 'Tiruvannamalai' },
      { teacherId: 'T103', name: 'Senthil Nathan', designation: 'Science Faculty (Physics & Chemistry)', phoneNumber: '9840112235', address: 'Tiruvannamalai' },
      { teacherId: 'T104', name: 'Malathi R', designation: 'Tamil Faculty', phoneNumber: '9840112236', address: 'Tiruvannamalai' },
      { teacherId: 'T105', name: 'Anand V', designation: 'Social Science Faculty', phoneNumber: '9840112237', address: 'Tiruvannamalai' },
      { teacherId: 'T106', name: 'Kavitha S', designation: 'Computer Science Instructor', phoneNumber: '9840112238', address: 'Tiruvannamalai' },
      { teacherId: 'T107', name: 'Murugan P', designation: 'Physical Education Director', phoneNumber: '9840112239', address: 'Tiruvannamalai' },
      { teacherId: 'T108', name: 'Geetha M', designation: 'Hindi & Moral Science Teacher', phoneNumber: '9840112240', address: 'Tiruvannamalai' }
    ];

    const createdTeachers = await Teacher.insertMany(initialTeachers);
    console.log(`  ✓ Created ${createdTeachers.length} initial teachers`);

    const subjects = await Subject.find().lean();
    const subMap = {};
    subjects.forEach(s => { subMap[s.code] = s._id; });

    const mappings = [
      { teacherId: createdTeachers[0]._id, code: 'MATH' },
      { teacherId: createdTeachers[1]._id, code: 'ENG' },
      { teacherId: createdTeachers[2]._id, code: 'SCI' },
      { teacherId: createdTeachers[3]._id, code: 'TAM' },
      { teacherId: createdTeachers[4]._id, code: 'SOC' },
      { teacherId: createdTeachers[5]._id, code: 'CS' },
      { teacherId: createdTeachers[6]._id, code: 'PE' },
      { teacherId: createdTeachers[7]._id, code: 'HIN' },
      { teacherId: createdTeachers[7]._id, code: 'GK' }
    ];

    for (const m of mappings) {
      if (subMap[m.code]) {
        await TeacherSubject.create({
          teacherId: m.teacherId,
          subjectId: subMap[m.code],
          maxWeeklyPeriods: 30
        });
      }
    }
    console.log('  ✓ Teacher-subject mappings initialized');
  } else {
    console.log(`  ✓ Teachers already exist (${teacherCount} teachers)`);
  }
}

async function seedExams(activeYear) {
  console.log('[8/9] Seeding Default Exam Terms...');
  const exams = [
    { name: 'TERM - I', displayOrder: 0, className: 'ALL' },
    { name: 'TERM - II', displayOrder: 1, className: 'ALL' },
    { name: 'TERM - III', displayOrder: 2, className: 'ALL' },
    { name: 'ANNUAL', displayOrder: 3, className: 'ALL' }
  ];

  for (const exam of exams) {
    await ProgressCardExam.findOneAndUpdate(
      { academicYear: activeYear, className: exam.className, name: exam.name },
      {
        $setOnInsert: {
          academicYear: activeYear,
          className: exam.className,
          name: exam.name,
          displayOrder: exam.displayOrder,
          isActive: true
        }
      },
      { upsert: true, new: true }
    );
  }
  console.log('  ✓ Exam terms initialized');
}

async function main() {
  console.log('==========================================================');
  console.log(' EDIFY MASTER DATABASE INITIAL SEEDING');
  console.log('==========================================================\n');

  try {
    await connectDB();
    console.log('Connected to MongoDB.\n');

    await seedUsers();
    const activeYear = await seedAcademicYear();
    await seedSettings();
    await seedClasses();
    await seedFeeCategories();
    await seedSubjectsAndTimetable(activeYear);
    await seedTeachers();
    await seedExams(activeYear);

    console.log('\n==========================================================');
    console.log(' [9/9] MASTER SEEDING COMPLETED SUCCESSFULLY! 🎉');
    console.log('==========================================================');
  } catch (error) {
    console.error('\n[ERROR] Seeding failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('\nDatabase connection closed cleanly.');
  }
}

main();
