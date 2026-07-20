import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from '../src/utils/db.js';
import { Student, StudentFee } from '../src/models/index.js';

async function run() {
  await connectDB();
  const student = await Student.findOne({ studentName: /Sneha Babu/i });
  if (student) {
    const fees = await StudentFee.find({ studentId: student._id }).populate('feeCategoryId').lean();
    console.log('Sneha Babu Student Fees:');
    fees.forEach(f => {
      console.log(`  Fee Category: ${f.feeCategoryId?.name || 'Unknown'} (${f.feeCategoryId?._id}), totalAmount = ₹${f.totalAmount}, paid = ₹${f.paidAmount}, remaining = ₹${f.remainingAmount}`);
      if (f.uniformDetails) {
        console.log('    uniformDetails:', f.uniformDetails);
      }
    });
  }
  mongoose.connection.close();
}
run();
