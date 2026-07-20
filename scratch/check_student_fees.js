import dotenv from 'dotenv';
import connectDB from '../src/utils/db.js';
import mongoose from 'mongoose';
import { Student, StudentFee } from '../src/models/index.js';

dotenv.config();

async function main() {
  await connectDB();

  // Find student by admission number
  const student = await Student.findOne({ admissionNumber: /ADM-001/i });
  if (!student) {
    console.log('No student found with admissionNumber ADM-001');
    mongoose.connection.close();
    return;
  }

  console.log('=== Student Info ===');
  console.log(JSON.stringify(student, null, 2));

  // Find all fees for this student
  const fees = await StudentFee.find({ studentId: student._id }).populate('feeCategoryId');
  console.log(`\n=== Student Fees count: ${fees.length} ===`);
  fees.forEach((f, idx) => {
    console.log(`\n--- Fee ${idx + 1} ---`);
    console.log(JSON.stringify(f, null, 2));
  });

  mongoose.connection.close();
}

main().catch(err => {
  console.error(err);
  mongoose.connection.close();
});
