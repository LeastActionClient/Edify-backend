import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from '../src/utils/db.js';
import { Student, StudentFee, StudentFeeConcession } from '../src/models/index.js';

async function run() {
  await connectDB();
  const student = await Student.findOne({ studentName: /Nandhini Ravi/i });
  if (!student) {
    console.log('Nandhini Ravi not found.');
    mongoose.connection.close();
    return;
  }
  console.log(`Student Nandhini Ravi ID: ${student._id}`);
  
  const fees = await StudentFee.find({ studentId: student._id }).populate('feeCategoryId').lean();
  console.log('\n--- Student Fees ---');
  fees.forEach(f => {
    console.log(`  Fee ID: ${f._id}, Category: ${f.feeCategoryId?.name} (${f.feeCategoryId?._id}), total: ₹${f.totalAmount}, remaining: ₹${f.remainingAmount}, paid: ₹${f.paidAmount}`);
  });

  const concessions = await StudentFeeConcession.find({ studentId: student._id }).populate('feeCategoryId').lean();
  console.log('\n--- Student Concessions ---');
  concessions.forEach(c => {
    console.log(`  Concession ID: ${c._id}, Category: ${c.feeCategoryId?.name} (${c.feeCategoryId?._id}), studentFeeId: ${c.studentFeeId}, lessAmount: ₹${c.lessAmount}, status: ${c.status}`);
  });

  mongoose.connection.close();
}
run();
