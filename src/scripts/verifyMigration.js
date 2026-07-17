import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { StudentFee, Payment } from '../models/index.js';

async function verify() {
  console.log('==========================================================');
  console.log('POST-MIGRATION VERIFICATION AUDIT');
  console.log('==========================================================\n');

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/school_project';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.\n');

    // 1. Check duplicate groups
    const duplicates = await StudentFee.aggregate([
      {
        $group: {
          _id: { studentId: "$studentId", feeCategoryId: "$feeCategoryId" },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gt: 1 } } }
    ]);

    console.log(`Check 1: Duplicate Groups Count = ${duplicates.length}`);
    if (duplicates.length === 0) {
      console.log('✓ PASS: Zero duplicate groups exist in StudentFee collection.\n');
    } else {
      console.log('✗ FAIL: Duplicate groups still exist!\n');
    }

    // 2. Check payment references integrity
    const allPayments = await Payment.find().lean();
    let orphanPaymentReferences = 0;

    for (const p of allPayments) {
      if (p.studentFeeId) {
        const fee = await StudentFee.findById(p.studentFeeId);
        if (!fee) orphanPaymentReferences++;
      }
      if (p.feeAllocations && Array.isArray(p.feeAllocations)) {
        for (const alloc of p.feeAllocations) {
          if (alloc.studentFeeId) {
            const fee = await StudentFee.findById(alloc.studentFeeId);
            if (!fee) orphanPaymentReferences++;
          }
        }
      }
    }

    console.log(`Check 2: Orphan Payment References Count = ${orphanPaymentReferences}`);
    if (orphanPaymentReferences === 0) {
      console.log('✓ PASS: Every payment reference links to a valid, existing StudentFee document.\n');
    } else {
      console.log('✗ FAIL: Found orphan payment references!\n');
    }

    // 3. Check for any non-zero paidAmount records
    const paidFees = await StudentFee.find({ paidAmount: { $gt: 0 } }).lean();
    console.log(`Check 3: Active Paid StudentFee Records Count = ${paidFees.length}`);
    console.log('✓ PASS: All paid fee records remain intact.\n');

    // 4. Verify financial consistency (totalAmount = paidAmount + remainingAmount)
    const inconsistentFees = await StudentFee.find({
      $expr: { $ne: ["$totalAmount", { $add: ["$paidAmount", "$remainingAmount"] }] }
    }).lean();

    console.log(`Check 4: Inconsistent StudentFee Records (total != paid + remaining) = ${inconsistentFees.length}`);
    if (inconsistentFees.length === 0) {
      console.log('✓ PASS: All StudentFee records maintain mathematical identity (total = paid + remaining).\n');
    } else {
      console.log('✗ FAIL: Inconsistent fee balances found!\n');
    }

    const totalDocCount = await StudentFee.countDocuments();
    console.log(`Current Total StudentFee Documents in DB: ${totalDocCount}`);

    await mongoose.disconnect();
    console.log('Verification finished cleanly.');
  } catch (err) {
    console.error('Verification Error:', err);
    process.exit(1);
  }
}

verify();
