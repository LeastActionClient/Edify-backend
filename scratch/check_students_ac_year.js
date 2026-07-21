import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from '../src/utils/db.js';
import { Student } from '../src/models/index.js';

async function run() {
  await connectDB();
  const students = await Student.find().lean();
  console.log('=== Academic Year of Students in DB ===');
  students.forEach(s => {
    console.log(`Student: "${s.studentName}" (Admission: "${s.admissionNumber}"), Academic Year: "${s.academicYear}"`);
  });
  mongoose.connection.close();
}
run();
