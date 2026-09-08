import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Payment from './src/models/Payment.js';
import StudentFee from './src/models/StudentFee.js';
import FeeCategory from './src/models/FeeCategory.js';
import IncludedCharge from './src/models/IncludedCharge.js';

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const paymentQuery = {
    paymentType: { $ne: 'APPLICATION' }
  };
  const payments = await Payment.find(paymentQuery)
    .populate({ path: 'studentFeeId', populate: [{ path: 'feeCategoryId', select: 'name' }, { path: 'includedChargeId', select: 'name' }] })
    .populate({ path: 'feeAllocations.studentFeeId', populate: [{ path: 'feeCategoryId', select: 'name' }, { path: 'includedChargeId', select: 'name' }] })
    .lean();
    
  payments.forEach(p => {
      if (p.feeAllocations && p.feeAllocations.length > 0) {
          p.feeAllocations.forEach(alloc => {
              const feeCatName = alloc.studentFeeId?.feeCategoryId?.name;
              const chargeName = alloc.studentFeeId?.includedChargeId?.name;
              console.log("Alloc Fee Name:", feeCatName || chargeName, "Amount:", alloc.amount);
          });
      } else {
          const feeCatName = p.studentFeeId?.feeCategoryId?.name;
          const chargeName = p.studentFeeId?.includedChargeId?.name;
          console.log("Payment Fee Name:", feeCatName || chargeName, "Amount:", p.amount);
      }
  });
  
  mongoose.disconnect();
}).catch(console.error);
