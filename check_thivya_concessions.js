import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { StudentFeeConcession, StudentFee } from './src/models/index.js';

dotenv.config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const id = '6a61e09417032ee59a47f0d0';
  const concessions = await StudentFeeConcession.find({ studentId: id }).lean();
  console.log("=== Concessions and Fees ===");
  for (const c of concessions) {
    const fee = await StudentFee.findById(c.studentFeeId).populate('feeCategoryId').lean();
    if (fee) {
      console.log(`Concession: Less: ${c.lessAmount}, Status: ${c.status}`);
      console.log(`- Fee ID: ${fee._id}, Category: ${fee.feeCategoryId?.name}, Class: ${fee.className}, Year: ${fee.academicYear}, Total: ${fee.totalAmount}, Remaining: ${fee.remainingAmount}, Paid: ${fee.paidAmount}`);
    } else {
      console.log(`Concession for orphan Fee ID: ${c.studentFeeId}`);
    }
  }
  await mongoose.disconnect();
}

check().catch(console.error);
