import connectDB from '../config/db.js';
import {
  Teacher,
  Subject,
  TeacherSubject
} from '../models/index.js';

async function seedTeachers() {
  await connectDB();

  const count = await Teacher.countDocuments();
  if (count > 0) {
    console.log('Teachers already exist, skipping seed.');
    process.exit(0);
  }

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
  console.log(`Created ${createdTeachers.length} initial teachers.`);

  // Map to default subjects
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

  console.log('Teacher-subject mappings initialized successfully.');
  process.exit(0);
}

seedTeachers().catch(err => {
  console.error(err);
  process.exit(1);
});
