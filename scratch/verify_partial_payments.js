import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from '../src/utils/db.js';
import { Student, StudentFee, Payment, StudentFeeConcession, Invoice } from '../src/models/index.js';
import { createPayment, getPaymentInvoiceData } from '../src/controllers/paymentController.js';

async function run() {
  await connectDB();
  console.log('MongoDB Connected successfully');

  // Pre-cleanup in case of previous partial runs
  await Student.deleteMany({ admissionNumber: 'ADM_TEST_PARTIAL' });

  // 1. Create a dummy student, student fees, and a concession
  const dummyStudentId = new mongoose.Types.ObjectId();
  const dummyFeeId1 = new mongoose.Types.ObjectId();
  const dummyFeeId2 = new mongoose.Types.ObjectId();
  const dummyCategoryId1 = new mongoose.Types.ObjectId();
  const dummyCategoryId2 = new mongoose.Types.ObjectId();

  await Student.create({
    _id: dummyStudentId,
    studentName: 'Test Partial Pay Student',
    admissionNumber: 'ADM_TEST_PARTIAL',
    currentClass: '8',
    section: 'A',
    studentStatus: 'Active'
  });

  // Fee 1: Original ₹1000, active concession ₹200, remaining should be ₹800
  await StudentFee.create({
    _id: dummyFeeId1,
    studentId: dummyStudentId,
    feeCategoryId: dummyCategoryId1,
    totalAmount: 1000,
    paidAmount: 0,
    remainingAmount: 1000,
    className: '8',
    section: 'A',
    academicYear: '2028-2029'
  });

  await StudentFeeConcession.create({
    studentId: dummyStudentId,
    feeCategoryId: dummyCategoryId1,
    studentFeeId: dummyFeeId1,
    lessAmount: 200,
    reason: 'Scholarship',
    status: 'Active',
    createdBy: new mongoose.Types.ObjectId(),
    originalAmount: 1000,
    className: '8',
    academicYear: '2028-2029'
  });

  // Fee 2: Original ₹500, no concessions
  await StudentFee.create({
    _id: dummyFeeId2,
    studentId: dummyStudentId,
    feeCategoryId: dummyCategoryId2,
    totalAmount: 500,
    paidAmount: 0,
    remainingAmount: 500,
    className: '8',
    section: 'A',
    academicYear: '2028-2029'
  });

  console.log('Dummy student, fees, and concessions initialized.');

  // 2. Perform Mock Payment API Call
  // Request contains custom allocations:
  // - Pay ₹300 for Fee 1 (Remaining: ₹800 - ₹300 = ₹500)
  // - Pay ₹400 for Fee 2 (Remaining: ₹500 - ₹400 = ₹100)
  // Total paid = ₹700
  const mockReq = {
    body: {
      studentId: dummyStudentId.toString(),
      studentFeeIds: [dummyFeeId1.toString(), dummyFeeId2.toString()],
      amount: 700,
      feeAllocations: [
        { studentFeeId: dummyFeeId1.toString(), amount: 300 },
        { studentFeeId: dummyFeeId2.toString(), amount: 400 }
      ],
      paymentMethod: 'CASH',
      referenceNumber: 'REF1234',
      remarks: 'Partial payment test'
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

  console.log('Sending mock createPayment request with feeAllocations...');
  await createPayment(mockReq, mockRes);

  if (mockRes.statusCode === 201) {
    console.log('[PASS] Payment created successfully. Response status code 201.');
  } else {
    console.log('[FAIL] Failed to create payment. Response:', responseData);
    process.exit(1);
  }

  // 3. Verify Database Records
  const fee1 = await StudentFee.findById(dummyFeeId1);
  const fee2 = await StudentFee.findById(dummyFeeId2);

  console.log('\n--- Database Integrity Verification ---');
  console.log(`Fee 1 (Original: 1000, Concession: 200) Paid Amount: ₹${fee1.paidAmount} (Expected: ₹300), Remaining Amount: ₹${fee1.remainingAmount} (Expected: ₹700)`);
  console.log(`Fee 2 (Original: 500) Paid Amount: ₹${fee2.paidAmount} (Expected: ₹400), Remaining Amount: ₹${fee2.remainingAmount} (Expected: ₹100)`);

  if (fee1.totalAmount === 1000 && fee1.paidAmount === 300 && fee1.remainingAmount === 700) {
    console.log('[PASS] Database updates for Fee 1 are correct!');
  } else {
    console.log('[FAIL] Database updates for Fee 1 are incorrect!');
    process.exit(1);
  }

  if (fee2.totalAmount === 500 && fee2.paidAmount === 400 && fee2.remainingAmount === 100) {
    console.log('[PASS] Database updates for Fee 2 are correct!');
  } else {
    console.log('[FAIL] Database updates for Fee 2 are incorrect!');
    process.exit(1);
  }

  // 4. Verify Invoice Details Breakdown
  const paymentId = responseData._id;
  const mockInvoiceReq = { params: { id: paymentId.toString() } };
  let invoiceData = null;
  const mockInvoiceRes = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.data = data;
      invoiceData = data;
      return this;
    }
  };

  await getPaymentInvoiceData(mockInvoiceReq, mockInvoiceRes);
  console.log('\n--- Invoice Context Grand Totals Mappings ---');
  const summary = invoiceData.summary;
  console.log('Invoice Summary Totals:', summary);
  // Let's verify each allocation's remaining amounts
  invoiceData.payment.feeAllocations.forEach((alloc, idx) => {
    console.log(`Allocation ${idx + 1} studentFeeId remainingAmount: ₹${alloc.studentFeeId.remainingAmount}`);
  });

  // Clean up test data
  await Student.findByIdAndDelete(dummyStudentId);
  await StudentFee.deleteMany({ studentId: dummyStudentId });
  await StudentFeeConcession.deleteMany({ studentId: dummyStudentId });
  await Payment.findByIdAndDelete(paymentId);
  await Invoice.deleteOne({ paymentId });

  console.log('\n=== ALL PARTIAL PAYMENT TESTS PASSED ===');
  mongoose.connection.close();
}

run();
