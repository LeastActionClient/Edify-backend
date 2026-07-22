import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

const studentSchema = new mongoose.Schema({
  studentName: String,
  currentClass: String,
  section: String,
  academicYear: String,
  studentStatus: String
});

const classSchema = new mongoose.Schema({
  name: String
});

const Student = mongoose.model('Student', studentSchema);
const Class = mongoose.model('Class', classSchema);

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');

    const student = await Student.findOne({
      studentName: { $regex: /thivya/i },
      currentClass: { $regex: /11/ }
    });

    console.log('--- Student Details ---');
    if (student) {
      console.log(JSON.stringify(student, null, 2));
    } else {
      console.log('Student not found');
    }

    console.log('--- Classes in DB ---');
    const classes = await Class.find({});
    classes.forEach(c => {
      console.log(`Class name: "${c.name}"`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
