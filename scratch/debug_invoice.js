import dotenv from 'dotenv';
import connectDB from '../src/utils/db.js';
import mongoose from 'mongoose';
import { Payment, StudentFeeConcession, Invoice } from '../src/models/index.js';

dotenv.config();

async function main() {
  await connectDB();

  const id = '6a5dc4510509db8ac02d23f0';
  const paymentDoc = await Payment.findById(id)
    .populate('studentId')
    .populate('applicationId')
    .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId' } })
    .populate({ path: 'feeAllocations.studentFeeId', populate: { path: 'feeCategoryId' } });

  if (!paymentDoc) {
    console.log('Payment not found in database');
    mongoose.connection.close();
    return;
  }

  const payment = paymentDoc.toObject();
  const invoiceDoc = await Invoice.findOne({ paymentId: id });
  const invoice = invoiceDoc ? invoiceDoc.toObject() : {};

  // Load and apply concessions dynamically to match discountAmount in PDF / invoice details
  const studentIdForConcessions = payment.studentId?._id || payment.studentId;
  const concessions = studentIdForConcessions 
    ? await StudentFeeConcession.find({ studentId: studentIdForConcessions, status: 'Active' }).lean()
    : [];
  
  console.log('Concessions found for student:', concessions.length);
  concessions.forEach(c => {
    console.log(`Concession: StudentFeeId = ${c.studentFeeId.toString()}, LessAmount = ${c.lessAmount}, Status = ${c.status}`);
  });

  const concessionMap = new Map(concessions.map(c => [c.studentFeeId.toString(), c.lessAmount]));

  if (payment.studentFeeId) {
    payment.studentFee = payment.studentFeeId;
    if (payment.studentFee.feeCategoryId) {
      payment.studentFee.feeCategory = payment.studentFee.feeCategoryId;
    }
    const lessAmt = concessionMap.get(payment.studentFee._id.toString()) || 0;
    console.log('Single fee payment - lessAmt:', lessAmt);
  }

  if (payment.feeAllocations && payment.feeAllocations.length > 0) {
    payment.feeAllocations.forEach((alloc, idx) => {
      if (alloc.studentFeeId) {
        const lessAmt = concessionMap.get(alloc.studentFeeId._id.toString()) || 0;
        console.log(`Allocation ${idx}: studentFeeId = ${alloc.studentFeeId._id.toString()}, lessAmt = ${lessAmt}`);
        console.log('  Before adjust: totalAmount =', alloc.studentFeeId.totalAmount, 'remainingAmount =', alloc.studentFeeId.remainingAmount);
        
        alloc.studentFeeId.lessAmount = lessAmt;
        alloc.studentFeeId.discountAmount = lessAmt;
        alloc.discountAmount = lessAmt;
        if (lessAmt > 0) {
          alloc.studentFeeId.originalTotalAmount = alloc.studentFeeId.totalAmount;
          alloc.studentFeeId.totalAmount = Math.max(0, alloc.studentFeeId.totalAmount - lessAmt);
          alloc.studentFeeId.remainingAmount = Math.max(0, alloc.studentFeeId.totalAmount - (alloc.studentFeeId.paidAmount || 0));
        }
        console.log('  After adjust: totalAmount =', alloc.studentFeeId.totalAmount, 'remainingAmount =', alloc.studentFeeId.remainingAmount);
      }
    });
  }

  mongoose.connection.close();
}

main().catch(err => {
  console.error(err);
  mongoose.connection.close();
});
