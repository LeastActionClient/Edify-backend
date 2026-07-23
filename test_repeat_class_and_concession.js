import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee, FeeCategory, StudentFeeConcession } from './src/models/index.js';
import * as studentController from './src/controllers/studentController.js';

dotenv.config();

async function runFinalVerification() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("==========================================================");
  console.log(" STARTING FINAL ACADEMIC YEAR & CONCESSION VERIFICATION");
  console.log("==========================================================");

  try {
    // Drop legacy index if exists to allow multi-year repeating class compound index
    try {
      await StudentFee.collection.dropIndex('studentId_1_feeCategoryId_1_className_1');
      console.log("Dropped legacy 3-key unique index on StudentFee.");
    } catch (e) {
      // index might already be dropped or not exist
    }

    await StudentFee.syncIndexes();

    const adminNo = "AY-REPEAT-99";

    // Clean up
    const existing = await Student.findOne({ admissionNumber: adminNo });
    if (existing) {
      await StudentFeeConcession.deleteMany({ studentId: existing._id });
      await StudentFee.deleteMany({ studentId: existing._id });
      await Student.deleteOne({ _id: existing._id });
    }

    // Step 1: Create Categories
    const baseCat = await FeeCategory.create({ name: `AY_Base_${Date.now()}`, amount: 4000, mandatory: true, isEnabled: true });
    const chargeCat = await FeeCategory.create({ name: `AY_Charge_${Date.now()}`, amount: 220, mandatory: false, isEnabled: true });

    // Step 2: Create Student in Class 6 (2031-2032)
    const student = await Student.create({
      admissionNumber: adminNo,
      studentName: 'Repeat Class & Concession Student',
      currentClass: '6',
      section: 'A',
      academicYear: '2031-2032',
      baseFee: 4000,
      grandTotal: 4220
    });
    const sId = student._id.toString();

    // Create Class 6 Fees for 2031-2032
    // 1. Base Fee ₹4000
    const fee2031Base = await StudentFee.create({ studentId: student._id, feeCategoryId: baseCat._id, totalAmount: 4000, paidAmount: 0, remainingAmount: 4000, className: '6', academicYear: '2031-2032' });
    // 2. Charges + Uniform ₹220
    const fee2031Charge = await StudentFee.create({ studentId: student._id, feeCategoryId: chargeCat._id, totalAmount: 220, paidAmount: 0, remainingAmount: 220, className: '6', academicYear: '2031-2032' });

    // Apply Concession ₹1000 to Base Fee (2031-2032)
    await StudentFeeConcession.create({
      academicYearId: new mongoose.Types.ObjectId(),
      studentId: student._id,
      studentFeeId: fee2031Base._id,
      feeCategoryId: baseCat._id,
      concessionAmount: 1000,
      lessAmount: 1000,
      originalAmount: 4000,
      reason: 'Special Discount',
      createdBy: new mongoose.Types.ObjectId(),
      academicYear: '2031-2032',
      className: '6',
      status: 'Active'
    });

    console.log("\n--- STAGE 1: Class 6 (2031-2032) Created ---");
    console.log(`Original Base Fee: ₹4000 | Concession: ₹1000 | Charges: ₹220`);

    // TEST SCENARIO A: Student REPEATS Class 6 in Academic Year 2032-2033
    student.currentClass = '6'; // SAME CLASS (REPEATING CLASS 6)
    student.academicYear = '2032-2033'; // NEW ACADEMIC YEAR
    await student.save();

    // Assign 2032-2033 Class 6 Fee ₹2000
    await StudentFee.create({ studentId: student._id, feeCategoryId: baseCat._id, totalAmount: 2000, paidAmount: 0, remainingAmount: 2000, className: '6', academicYear: '2032-2033' });

    console.log("\n--- STAGE 2: Student REPEATS Class 6 in New Academic Year 2032-2033 ---");

    // Fetch via getStudents (Directory / Pending Fees / Reports)
    let apiStuData = null;
    const mockRes1 = { status: () => mockRes1, json: (d) => { apiStuData = d?.[0]; return mockRes1; } };
    await studentController.getStudents({ query: { search: adminNo } }, mockRes1);

    // Fetch via getStudentById (Student Details / Payment Screen)
    let apiStuDetailData = null;
    const mockRes2 = { status: () => mockRes2, json: (d) => { apiStuDetailData = d; return mockRes2; } };
    await studentController.getStudentById({ params: { id: sId } }, mockRes2);

    console.log("\n--- VERIFICATION AUDIT RESULTS ---");
    console.log(`1. getStudents API Previous Pending      : ₹${apiStuData.previousPending} (Expected: ₹3220)`);
    console.log(`2. getStudentById API Previous Pending   : ₹${apiStuDetailData.previousPending} (Expected: ₹3220)`);
    console.log(`3. getStudents Current Year Pending (2032): ₹${apiStuData.currentPending} (Expected: ₹2000)`);
    console.log(`4. getStudents Total Pending Dues         : ₹${apiStuData.totalDue} (Expected: ₹5220)`);

    const isRepeatClassPassed = apiStuData.previousPending === 3220;
    const isConcessionAdjusted = apiStuData.previousPending === 3220 && (apiStuData.previousPending !== 4000 && apiStuData.previousPending !== 3000);
    const isConsistentAcrossScreens = apiStuData.previousPending === apiStuDetailData.previousPending;

    if (isRepeatClassPassed && isConcessionAdjusted && isConsistentAcrossScreens) {
      console.log("\n=======================================================");
      console.log(" 🎉 SUCCESS: ACADEMIC YEAR ISOLATION & CONCESSION ADJUSTED CARRY FORWARD PASSED PERFECTLY!");
      console.log("=======================================================");
    } else {
      console.error("\n❌ VERIFICATION FAILED!");
    }

    // Cleanup
    await StudentFeeConcession.deleteMany({ studentId: student._id });
    await StudentFee.deleteMany({ studentId: student._id });
    await Student.deleteOne({ _id: student._id });
    await FeeCategory.deleteMany({ _id: { $in: [baseCat._id, chargeCat._id] } });
    console.log("Cleanup completed successfully.");

  } catch (err) {
    console.error("Test error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

runFinalVerification();
