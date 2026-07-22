import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

const enrollmentSchema = new mongoose.Schema({}, { strict: false });
const StudentEnrollment = mongoose.model('StudentEnrollment', enrollmentSchema, 'studentenrollments');

const activityLogSchema = new mongoose.Schema({}, { strict: false });
const ActivityLog = mongoose.model('ActivityLog', activityLogSchema, 'activitylogs');

const studentSchema = new mongoose.Schema({}, { strict: false });
const Student = mongoose.model('Student', studentSchema, 'students');

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');

    console.log('--- Recent Activity Logs ---');
    const logs = await ActivityLog.find({ action: 'PROMOTED_STUDENTS' }).sort({ createdAt: -1 }).limit(5);
    logs.forEach(l => {
      console.log(JSON.stringify(l, null, 2));
    });

    console.log('--- Enrollments for student thivya ---');
    const thivya = await Student.findOne({ studentName: 'thivya', currentClass: '11' });
    if (thivya) {
      console.log('Student thivya found ID:', thivya._id);
      const enrollments = await StudentEnrollment.find({ studentId: thivya._id });
      console.log(JSON.stringify(enrollments, null, 2));
    } else {
      console.log('Student thivya not found');
    }

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
