import dotenv from 'dotenv';
import connectDB from '../src/utils/db.js';
import mongoose from 'mongoose';
import { Student, StudentFee, StudentFeeConcession, Payment } from '../src/models/index.js';
import { getStudentById } from '../src/controllers/studentController.js';
import { createPayment, getPaymentInvoiceData } from '../src/controllers/paymentController.js';

dotenv.config();

// Helper to mock express req/res correctly handling status code chain
const makeMockRes = (resolve, reject) => {
  const res = {
    statusCode: 200,
    status: (code) => {
      res.statusCode = code;
      return res;
    },
    json: (data) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(data);
      } else {
        reject(new Error(`HTTP ${res.statusCode}: ${data.error || JSON.stringify(data)}`));
      }
    }
  };
  return res;
};

async function runTests() {
  try {
    await connectDB();
    console.log('MongoDB Connected successfully');

    // 1. Find or create a test student
    let student = await Student.findOne({ admissionNumber: 'TEST-PAY-001' });
    if (!student) {
      student = await Student.create({
        admissionNumber: 'TEST-PAY-001',
        studentName: 'Yazhini Concession Test',
        currentClass: '8',
        section: 'A',
        studentStatus: 'Active'
      });
    }

    // 2. Clear old test data for this student
    await StudentFee.deleteMany({ studentId: student._id });
    await StudentFeeConcession.deleteMany({ studentId: student._id });
    await Payment.deleteMany({ studentId: student._id });

    // 3. Create a test student fee of ₹1000
    const mockCatId = new mongoose.Types.ObjectId();
    const feeDoc = await StudentFee.create({
      studentId: student._id,
      feeCategoryId: mockCatId,
      totalAmount: 1000,
      paidAmount: 0,
      remainingAmount: 1000,
      className: '8',
      academicYear: '2028–2029'
    });

    console.log('Created test StudentFee: ID =', feeDoc._id, 'Total = ₹1000');

    // 4. Create an active concession of ₹500
    const concessionDoc = await StudentFeeConcession.create({
      studentId: student._id,
      studentFeeId: feeDoc._id,
      feeCategoryId: mockCatId,
      originalAmount: 1000,
      lessAmount: 500,
      status: 'Active',
      reason: 'Staff concession',
      className: '8',
      section: 'A',
      academicYear: '2028–2029',
      createdBy: new mongoose.Types.ObjectId()
    });

    console.log('Created active StudentFeeConcession: Less Amount = ₹500');

    // 5. Verify dynamic deduction in getStudentById response
    console.log('\n--- Test 1: getStudentById dynamic deduction ---');
    const reqGet = { params: { id: student._id.toString() } };
    const getStudentData = await new Promise((resolve, reject) => {
      getStudentById(reqGet, makeMockRes(resolve, reject));
    });

    const parsedFee = getStudentData.studentFees.find(f => f._id.toString() === feeDoc._id.toString());
    console.log('Mapped StudentFee in response:');
    console.log('  totalAmount (effective original):', parsedFee.totalAmount);
    console.log('  remainingAmount (effective balance):', parsedFee.remainingAmount);
    console.log('  lessAmount:', parsedFee.lessAmount);

    if (parsedFee.totalAmount === 1000 && parsedFee.remainingAmount === 500 && parsedFee.lessAmount === 500) {
      console.log('[PASS] Dynamic deduction in getStudentById is correct!');
    } else {
      throw new Error(`[FAIL] Dynamic deduction failed. Got totalAmount=${parsedFee.totalAmount}, remainingAmount=${parsedFee.remainingAmount}`);
    }

    // 6. Verify Payment Transaction recording against the reduced remaining amount
    console.log('\n--- Test 2: createPayment with concession ---');
    const reqPay = {
      body: {
        studentId: student._id.toString(),
        studentFeeIds: [feeDoc._id.toString()],
        amount: 500, // full payment of net remaining balance
        paymentMethod: 'Cash',
        remarks: 'Paying concessions balance'
      },
      user: { id: new mongoose.Types.ObjectId() }
    };

    const paymentResult = await new Promise((resolve, reject) => {
      createPayment(reqPay, makeMockRes(resolve, reject));
    });

    console.log('Payment created:', paymentResult.message || 'Success');

    // Check student fee state in DB
    const updatedFee = await StudentFee.findById(feeDoc._id);
    console.log('Updated StudentFee in DB:');
    console.log('  totalAmount (DB original):', updatedFee.totalAmount);
    console.log('  paidAmount (DB):', updatedFee.paidAmount);
    console.log('  remainingAmount (DB):', updatedFee.remainingAmount);

    // Fetch student profile again to confirm it shows 0 remaining
    const getStudentDataPost = await new Promise((resolve, reject) => {
      getStudentById(reqGet, makeMockRes(resolve, reject));
    });
    const parsedFeePost = getStudentDataPost.studentFees.find(f => f._id.toString() === feeDoc._id.toString());
    console.log('Dynamic status post-payment:');
    console.log('  totalAmount (effective):', parsedFeePost.totalAmount);
    console.log('  remainingAmount (effective):', parsedFeePost.remainingAmount);

    if (updatedFee.totalAmount === 1000 && updatedFee.paidAmount === 500 && updatedFee.remainingAmount === 500 && parsedFeePost.remainingAmount === 0) {
      console.log('[PASS] Payment transaction recorded and dynamically marked as fully paid successfully!');
    } else {
      throw new Error('[FAIL] Payment transaction balance mismatch.');
    }

    // 7. Verify dynamic concession mapping in Invoice/Receipt
    console.log('\n--- Test 3: getPaymentInvoiceData invoice totals mapping ---');
    // Find the payment document
    const paymentDoc = await Payment.findOne({ studentId: student._id });
    const reqInv = { params: { id: paymentDoc._id.toString() } };
    const invoiceContext = await new Promise((resolve, reject) => {
      getPaymentInvoiceData(reqInv, makeMockRes(resolve, reject));
    });

    const alloc = invoiceContext.payment.feeAllocations?.[0];
    console.log('Invoice Payment allocation summary:');
    console.log('  alloc discountAmount (allocation):', alloc?.discountAmount);
    console.log('  studentFeeId lessAmount (populated):', alloc?.studentFeeId?.lessAmount);
    console.log('  studentFeeId totalAmount (populated, original):', alloc?.studentFeeId?.totalAmount);
    console.log('  studentFeeId remainingAmount (populated, net remaining):', alloc?.studentFeeId?.remainingAmount);

    if (alloc?.discountAmount === 500 && alloc?.studentFeeId?.lessAmount === 500 && alloc?.studentFeeId?.totalAmount === 1000 && alloc?.studentFeeId?.remainingAmount === 0) {
      console.log('[PASS] Invoice context contains correct concessions details and total amounts!');
    } else {
      throw new Error('[FAIL] Invoice context concession details mismatch.');
    }

    console.log('\n=== ALL PAYMENT AND BALANCE TESTS PASSED ===');
    mongoose.connection.close();
  } catch (err) {
    console.error('Test execution failed:', err);
    mongoose.connection.close();
  }
}

runTests();
