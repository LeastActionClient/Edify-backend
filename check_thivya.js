import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee, StudentEnrollment } from './src/models/index.js';

dotenv.config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const id = '6a61e09417032ee59a47f0d0';
  const student = await Student.findById(id).lean();
  console.log("=== Student Profile ===");
  console.log("Name:", student.studentName);
  console.log("Current Class:", student.currentClass);
  console.log("Section:", student.section);
  console.log("Academic Year:", student.academicYear);

  const enrollments = await StudentEnrollment.find({ studentId: id }).lean();
  console.log("\n=== Enrollments ===");
  enrollments.forEach(e => {
    console.log(`Class: ${e.className}, Year: ${e.academicYear}, Status: ${e.status}`);
  });

  const fees = await StudentFee.find({ studentId: id }).populate('feeCategoryId').lean();
  console.log("\n=== Fees ===");
  fees.forEach(f => {
    console.log(`ID: ${f._id}, Category: ${f.feeCategoryId?.name}, Class: ${f.className}, Year: ${f.academicYear}, Total: ${f.totalAmount}, Remaining: ${f.remainingAmount}, Paid: ${f.paidAmount}`);
  });

  await mongoose.disconnect();
}

check().catch(console.error);
