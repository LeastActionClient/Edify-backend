import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from '../src/utils/db.js';
import { Student, StudentFee, Payment, StudentFeeConcession, Invoice } from '../src/models/index.js';
import { createPayment, getPaymentInvoiceData } from '../src/controllers/paymentController.js';

async function run() {
  await connectDB();
  console.log('MongoDB Connected successfully');

  // Pre-cleanup
  await Student.deleteMany({ admissionNumber: 'ADM_TEST_ZERO' });

  // 1. Create dummy student and a fully concessioned fee
  const dummyStudentId = new mongoose.Types.ObjectId();
  const dummyFeeId = new mongoose.Types.ObjectId();
  const dummyCategoryId = new mongoose.Types.ObjectId();

  await Student.create({
    _id: dummyStudentId,
    studentName: 'Test Zero Pay Student',
    admissionNumber: 'ADM_TEST_ZERO',
    currentClass: '5',
    section: 'A',
    studentStatus: 'Active'
  });

  // Fee: Original ₹4500, Concession: ₹4500 (Fully lessed!)
  await StudentFee.create({
    _id: dummyFeeId,
    studentId: dummyStudentId,
    feeCategoryId: dummyCategoryId,
    totalAmount: 4500,
    paidAmount: 0,
    remainingAmount: 4500,
    className: '5',
    section: 'A',
    academicYear: '2028-2029'
  });

  await StudentFeeConcession.create({
    studentId: dummyStudentId,
    feeCategoryId: dummyCategoryId,
    studentFeeId: dummyFeeId,
    lessAmount: 4500,
    reason: '100% Concession',
    status: 'Active',
    createdBy: new mongoose.Types.ObjectId(),
    originalAmount: 4500,
    className: '5',
    academicYear: '2028-2029'
  });

  console.log('Fully lessed dummy fee initialized.');

  // 2. Perform Mock Payment API Call for ₹0
  const mockReq = {
    body: {
      studentId: dummyStudentId.toString(),
      studentFeeIds: [dummyFeeId.toString()],
      amount: 0,
      feeAllocations: [
        { studentFeeId: dummyFeeId.toString(), amount: 0 }
      ],
      paymentMethod: 'CASH',
      referenceNumber: '',
      remarks: 'Zero payment test'
    },
    user: { id: new mongoose.Types.ObjectId().toString() }
  };

  let responseData = null;
  const mockRes = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.data = data;
      responseData = data;
      return this;
    }
  };

  console.log('Sending mock createPayment request with ₹0 amount...');
  await createPayment(mockReq, mockRes);

  if (mockRes.statusCode === 201) {
    console.log('[PASS] Zero payment created successfully. Status 201.');
  } else {
    console.log('[FAIL] Zero payment failed. Response:', responseData);
    process.exit(1);
  }

  // 3. Verify Database Records
  const fee = await StudentFee.findById(dummyFeeId);
  console.log('\n--- Database Verification ---');
  console.log(`Fee totalAmount: ₹${fee.totalAmount}, paidAmount: ₹${fee.paidAmount}, remainingAmount: ₹${fee.remainingAmount}`);
  
  if (fee.paidAmount === 0 && fee.remainingAmount === 4500) {
    console.log('[PASS] Database values are correct (preserved at 0 paid, 4500 remaining)!');
  } else {
    console.log('[FAIL] Database values are incorrect!');
    process.exit(1);
  }

  // 4. Verify Invoice context
  const paymentId = responseData._id;
  const mockInvoiceReq = { params: { id: paymentId.toString() } };
  let invoiceData = null;
  const mockInvoiceRes = {
    status(code) { return this; },
    json(data) { invoiceData = data; return this; }
  };

  await getPaymentInvoiceData(mockInvoiceReq, mockInvoiceRes);
  console.log('\n--- Invoice Context Verification ---');
  console.log('Invoice Payment details - total amount paid:', invoiceData.payment.amount);
  console.log('Allocation amount:', invoiceData.payment.feeAllocations[0].amount);
  console.log('Allocation discountAmount (less):', invoiceData.payment.feeAllocations[0].discountAmount);

  if (invoiceData.payment.amount === 0 && invoiceData.payment.feeAllocations[0].amount === 0 && invoiceData.payment.feeAllocations[0].discountAmount === 4500) {
    console.log('[PASS] Invoice context matches zero payment allocations correctly!');
  } else {
    console.log('[FAIL] Invoice context is incorrect!');
    process.exit(1);
  }

  // Clean up
  await Student.findByIdAndDelete(dummyStudentId);
  await StudentFee.deleteMany({ studentId: dummyStudentId });
  await StudentFeeConcession.deleteMany({ studentId: dummyStudentId });
  await Payment.findByIdAndDelete(paymentId);
  await Invoice.deleteOne({ paymentId });

  console.log('\n=== ALL ZERO PAYMENT TESTS PASSED ===');
  mongoose.connection.close();
}

run();
