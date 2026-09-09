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
    
  let abacusKitTotal = 0;
  
  payments.forEach(p => {
      if (p.feeAllocations && p.feeAllocations.length > 0) {
          p.feeAllocations.forEach(alloc => {
              const name = alloc.studentFeeId?.feeCategoryId?.name;
              console.log("Alloc Fee Name:", name, "Amount:", alloc.amount);
              if (name === 'Abacus kit') {
                  abacusKitTotal += alloc.amount;
              }
          });
      } else {
          const name = p.studentFeeId?.feeCategoryId?.name;
          console.log("Payment Fee Name:", name, "Amount:", p.amount);
          if (name === 'Abacus kit') {
              abacusKitTotal += p.amount;
          }
      }
  });
  
  console.log("Total for 'Abacus kit':", abacusKitTotal);
  mongoose.disconnect();
}).catch(console.error);
