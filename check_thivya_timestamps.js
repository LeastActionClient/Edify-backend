import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { StudentFee } from './src/models/index.js';

dotenv.config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const id = '6a61e09417032ee59a47f0d0';
  const fees = await StudentFee.find({ studentId: id }).populate('feeCategoryId').lean();
  console.log("=== Fees Timestamps ===");
  fees.forEach(f => {
    console.log(`Cat: ${f.feeCategoryId?.name}, Class: ${f.className}, Total: ${f.totalAmount}, Remaining: ${f.remainingAmount}`);
    console.log(`  Created: ${f.createdAt}, Updated: ${f.updatedAt}`);
  });
  await mongoose.disconnect();
}

check().catch(console.error);
