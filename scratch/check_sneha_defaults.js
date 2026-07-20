import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from '../src/utils/db.js';
import { Student, Class, Section } from '../src/models/index.js';

async function run() {
  await connectDB();
  const student = await Student.findOne({ studentName: /Sneha Babu/i });
  if (student) {
    console.log('Student:', student.studentName, 'Class:', student.currentClass, 'Section:', student.section);

    const classDoc = await Class.findOne({ name: student.currentClass }).lean();
    console.log('Class defaultFees:', JSON.stringify(classDoc?.defaultFees, null, 2));

    if (classDoc && student.section) {
      const sectionDoc = await Section.findOne({ name: student.section, classId: classDoc._id }).lean();
      console.log('Section defaultFees:', JSON.stringify(sectionDoc?.defaultFees, null, 2));
    }
  } else {
    console.log('Sneha Babu not found.');
  }

  mongoose.connection.close();
}
run();
