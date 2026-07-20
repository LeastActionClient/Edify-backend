import dotenv from 'dotenv';
import connectDB from '../src/utils/db.js';
import mongoose from 'mongoose';
import { Student, StudentFee } from '../src/models/index.js';

dotenv.config();

async function main() {
  await connectDB();

  // Find all student fees
  const fees = await StudentFee.find().populate('studentId').populate('feeCategoryId');
  console.log(`Total StudentFee records: ${fees.length}`);

  const studentFeeCounts = {};
  fees.forEach(fee => {
    if (!fee.studentId) return;
    const key = `${fee.studentId.admissionNumber} — ${fee.studentId.studentName} (Class: ${fee.studentId.currentClass}, Section: ${fee.studentId.section})`;
    if (!studentFeeCounts[key]) studentFeeCounts[key] = [];
    studentFeeCounts[key].push(fee.feeCategoryId?.name + ' (₹' + fee.totalAmount + ')');
  });

  console.log('\n=== STUDENTS WITH ASSIGNED FEES ===');
  Object.keys(studentFeeCounts).slice(0, 10).forEach(key => {
    console.log(`\n* Student: ${key}`);
    console.log(`  Assigned Fees: ${studentFeeCounts[key].join(', ')}`);
  });

  mongoose.connection.close();
}

main().catch(err => {
  console.error(err);
  mongoose.connection.close();
});
