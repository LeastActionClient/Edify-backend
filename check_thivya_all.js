import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee } from './src/models/index.js';

dotenv.config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const students = await Student.find({ admissionNumber: 'ADM-007' }).lean();
  console.log("=== ADM-007 Students ===");
  for (const s of students) {
    console.log(`ID: ${s._id}, Name: ${s.studentName}, Class: ${s.currentClass}, Year: ${s.academicYear}`);
    const fees = await StudentFee.find({ studentId: s._id }).populate('feeCategoryId').lean();
    console.log("Fees:");
    fees.forEach(f => {
      console.log(`- ID: ${f._id}, Cat: ${f.feeCategoryId?.name}, Class: ${f.className}, Year: ${f.academicYear}, Total: ${f.totalAmount}, Remaining: ${f.remainingAmount}, Paid: ${f.paidAmount}`);
    });
  }
  await mongoose.disconnect();
}

check().catch(console.error);
