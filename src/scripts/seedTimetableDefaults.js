import connectDB from '../config/db.js';
import {
  Subject,
  TimetableConfig,
  AcademicYear
} from '../models/index.js';

async function seed() {
  await connectDB();

  const activeYear = await AcademicYear.findOne({ status: 'Active' });
  const year = activeYear?.year || '2026–2027';

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

  let config = await TimetableConfig.findOne({ academicYear: year, classId: null });
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
      academicYear: year,
      classId: null,
      className: 'All',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      periods: defaultPeriods
    });
  }

  console.log('Default subjects and timetable config initialized successfully.');
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
