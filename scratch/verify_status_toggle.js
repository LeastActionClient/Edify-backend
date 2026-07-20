import dotenv from 'dotenv';
import connectDB from '../src/utils/db.js';
import mongoose from 'mongoose';
import { Student, StudentFee, StudentFeeConcession, ActivityLog } from '../src/models/index.js';
import { getStudentById } from '../src/controllers/studentController.js';
import { toggleConcessionStatus } from '../src/controllers/concessionController.js';

dotenv.config();

// Helper to mock express req/res
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
    let student = await Student.findOne({ admissionNumber: 'TEST-TOGGLE-001' });
    if (!student) {
      student = await Student.create({
        admissionNumber: 'TEST-TOGGLE-001',
        studentName: 'Madhavan Status Toggle Test',
        currentClass: '10',
        section: 'B',
        studentStatus: 'Active'
      });
    }

    // 2. Clear old test data for this student
    await StudentFee.deleteMany({ studentId: student._id });
    await StudentFeeConcession.deleteMany({ studentId: student._id });
    await ActivityLog.deleteMany({ details: { $regex: /TEST-TOGGLE-001/i } });

    // 3. Create a test student fee of ₹2500
    const mockCatId = new mongoose.Types.ObjectId();
    const feeDoc = await StudentFee.create({
      studentId: student._id,
      feeCategoryId: mockCatId,
      totalAmount: 2500,
      paidAmount: 500,
      remainingAmount: 2000,
      className: '10',
      academicYear: '2028–2029'
    });

    console.log('Created test StudentFee: ID =', feeDoc._id, 'Total = ₹2500, Paid = ₹500, Remaining = ₹2000');

    // 4. Create an active concession of ₹1000
    const concessionDoc = await StudentFeeConcession.create({
      studentId: student._id,
      studentFeeId: feeDoc._id,
      feeCategoryId: mockCatId,
      originalAmount: 2500,
      lessAmount: 1000,
      status: 'Active',
      reason: 'Scholarship',
      className: '10',
      section: 'B',
      academicYear: '2028–2029',
      createdBy: new mongoose.Types.ObjectId()
    });

    console.log('Created active StudentFeeConcession: ID =', concessionDoc._id, 'Less Amount = ₹1000');

    // 5. Verify dynamic deduction while ACTIVE
    console.log('\n--- Step 5: Verify Active Concession calculations ---');
    const reqGet = { params: { id: student._id.toString() } };
    let getStudentData = await new Promise((resolve, reject) => {
      getStudentById(reqGet, makeMockRes(resolve, reject));
    });

    let parsedFee = getStudentData.studentFees.find(f => f._id.toString() === feeDoc._id.toString());
    console.log('Active Status Mapped:');
    console.log('  totalAmount (original preserved):', parsedFee.totalAmount);
    console.log('  lessAmount:', parsedFee.lessAmount);
    console.log('  concessionStatus:', parsedFee.concessionStatus);
    console.log('  remainingAmount (dynamic balance):', parsedFee.remainingAmount);

    if (parsedFee.totalAmount === 2500 && parsedFee.lessAmount === 1000 && parsedFee.concessionStatus === 'Active' && parsedFee.remainingAmount === 1000) {
      console.log('[PASS] Active concession applies dynamic balance correctly (2500 - 1000 less - 500 paid = 1000 remaining)');
    } else {
      throw new Error('[FAIL] Active concession calculations incorrect.');
    }

    // 6. Deactivate concession status
    console.log('\n--- Step 6: Toggle status to INACTIVE ---');
    const reqPatchDeactivate = {
      params: { id: concessionDoc._id.toString() },
      body: { status: 'INACTIVE' },
      user: { id: new mongoose.Types.ObjectId() }
    };
    const deactivateResult = await new Promise((resolve, reject) => {
      toggleConcessionStatus(reqPatchDeactivate, makeMockRes(resolve, reject));
    });
    console.log('API Toggle Result:', deactivateResult.message);

    // 7. Verify dynamic deduction while INACTIVE
    console.log('\n--- Step 7: Verify Inactive Concession calculations ---');
    getStudentData = await new Promise((resolve, reject) => {
      getStudentById(reqGet, makeMockRes(resolve, reject));
    });

    parsedFee = getStudentData.studentFees.find(f => f._id.toString() === feeDoc._id.toString());
    console.log('Inactive Status Mapped:');
    console.log('  totalAmount (original preserved):', parsedFee.totalAmount);
    console.log('  lessAmount:', parsedFee.lessAmount);
    console.log('  concessionStatus:', parsedFee.concessionStatus);
    console.log('  remainingAmount (dynamic balance):', parsedFee.remainingAmount);

    if (parsedFee.totalAmount === 2500 && parsedFee.lessAmount === 1000 && parsedFee.concessionStatus === 'Inactive' && parsedFee.remainingAmount === 2000) {
      console.log('[PASS] Inactive concession is ignored in dynamic balance (2500 total - 500 paid = 2000 remaining)');
    } else {
      throw new Error('[FAIL] Inactive concession calculations incorrect.');
    }

    // 8. Reactivate concession status
    console.log('\n--- Step 8: Toggle status to ACTIVE ---');
    const reqPatchReactivate = {
      params: { id: concessionDoc._id.toString() },
      body: { status: 'ACTIVE' },
      user: { id: new mongoose.Types.ObjectId() }
    };
    const reactivateResult = await new Promise((resolve, reject) => {
      toggleConcessionStatus(reqPatchReactivate, makeMockRes(resolve, reject));
    });
    console.log('API Toggle Result:', reactivateResult.message);

    // 9. Verify dynamic deduction after Reactivation
    console.log('\n--- Step 9: Verify Reactivated Concession calculations ---');
    getStudentData = await new Promise((resolve, reject) => {
      getStudentById(reqGet, makeMockRes(resolve, reject));
    });

    parsedFee = getStudentData.studentFees.find(f => f._id.toString() === feeDoc._id.toString());
    console.log('Re-active Status Mapped:');
    console.log('  remainingAmount (dynamic balance):', parsedFee.remainingAmount);

    if (parsedFee.remainingAmount === 1000) {
      console.log('[PASS] Reactivated concession correctly applies dynamic balance again!');
    } else {
      throw new Error('[FAIL] Reactivated concession calculations incorrect.');
    }

    // 10. Verify Audit Log entries
    console.log('\n--- Step 10: Verify Activity Logs ---');
    const logs = await ActivityLog.find({ action: 'UPDATE_CONCESSION_SUPER_ADMIN' }).sort({ createdAt: -1 });
    console.log(`Found ${logs.length} toggle activity logs.`);
    logs.forEach(l => console.log('  Log details:', l.details));

    if (logs.length >= 2) {
      console.log('[PASS] Status change audits recorded successfully!');
    } else {
      throw new Error('[FAIL] Status change audit logs not recorded correctly.');
    }

    // 11. Verify StudentFee record remains unchanged in DB
    console.log('\n--- Step 11: Verify StudentFee in DB remains unmodified ---');
    const dbFee = await StudentFee.findById(feeDoc._id);
    console.log('DB StudentFee Values:');
    console.log('  totalAmount (DB):', dbFee.totalAmount);
    console.log('  remainingAmount (DB):', dbFee.remainingAmount);
    console.log('  paidAmount (DB):', dbFee.paidAmount);

    if (dbFee.totalAmount === 2500 && dbFee.remainingAmount === 2000 && dbFee.paidAmount === 500) {
      console.log('[PASS] Mongoose StudentFee record preserved (Original financial truth untouched).');
    } else {
      throw new Error('[FAIL] StudentFee record was modified in database.');
    }

    console.log('\n=== ALL TOGGLE STATUS AND BALANCE TESTS PASSED SUCCESSFULY! ===');
    mongoose.connection.close();
  } catch (err) {
    console.error('Test execution failed:', err);
    mongoose.connection.close();
  }
}

runTests();
