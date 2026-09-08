import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Payment from './src/models/Payment.js';
import StudentFee from './src/models/StudentFee.js';
import FeeCategory from './src/models/FeeCategory.js';

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const paymentQuery = {
    paymentType: { $ne: 'APPLICATION' }
  };
  const payments = await Payment.find(paymentQuery)
    .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId', select: 'name' } })
    .populate({ path: 'feeAllocations.studentFeeId', populate: { path: 'feeCategoryId', select: 'name' } })
    .lean();
    
  console.log("Total payments:", payments.length);
  const sample = payments.find(p => p.feeAllocations && p.feeAllocations.length > 0);
  if (sample) {
      console.log("Sample with allocations:");
      console.log(JSON.stringify(sample.feeAllocations[0], null, 2));
  } else {
      console.log("No allocations found");
  }
  mongoose.disconnect();
}).catch(console.error);
