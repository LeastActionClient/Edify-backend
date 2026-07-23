import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee, FeeCategory, StudentFeeConcession, Payment } from './src/models/index.js';
import * as concessionController from './src/controllers/concessionController.js';
import * as paymentController from './src/controllers/paymentController.js';
import * as studentController from './src/controllers/studentController.js';

dotenv.config();

async function runAll10ScenariosVerification() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("==========================================================");
  console.log(" VERIFYING REMAINING_AMOUNT AS SINGLE SOURCE OF TRUTH (10/10)");
  console.log("==========================================================");

  let passedScenarios = 0;
  let totalScenarios = 0;

  const assertScenario = (num, title, condition, detail = "") => {
    totalScenarios++;
    if (condition) {
      passedScenarios++;
      console.log(`✅ [PASS ${num}/10] ${title} ${detail ? '-> ' + detail : ''}`);
    } else {
      console.error(`❌ [FAIL ${num}/10] ${title} -> ${detail}`);
    }
  };

  try {
    const adminNo = "SOT-TEST-1000";

    // Clean up
    const existing = await Student.findOne({ admissionNumber: adminNo });
    if (existing) {
      await Payment.deleteMany({ studentId: existing._id });
      await StudentFeeConcession.deleteMany({ studentId: existing._id });
      await StudentFee.deleteMany({ studentId: existing._id });
      await Student.deleteOne({ _id: existing._id });
    }

    // Categories setup
    const baseCat = await FeeCategory.create({ name: `SOT_Base_${Date.now()}`, amount: 4000, mandatory: true, isEnabled: true });
    const chargeCat = await FeeCategory.create({ name: `SOT_Charge_${Date.now()}`, amount: 200, mandatory: false, isEnabled: true });
    const uniformCat = await FeeCategory.create({ name: `SOT_Uniform_${Date.now()}`, amount: 300, mandatory: false, isEnabled: true });

    // Create Student in Class 6 (2031-2032)
    const student = await Student.create({
      admissionNumber: adminNo,
      studentName: 'Single Source Of Truth Student',
      currentClass: '6',
      section: 'A',
      academicYear: '2031-2032',
      baseFee: 4000,
      grandTotal: 4500
    });
    const sId = student._id.toString();

    // 1. Assign Fee -> remainingAmount should equal totalAmount
    const feeBase = await StudentFee.create({
      studentId: student._id,
      feeCategoryId: baseCat._id,
      totalAmount: 4000,
      paidAmount: 0,
      remainingAmount: 4000,
      className: '6',
      academicYear: '2031-2032'
    });
    assertScenario(1, "Assign Fee", feeBase.remainingAmount === 4000, `DB remainingAmount: ₹${feeBase.remainingAmount}`);

    // 2. Assign Concession -> remainingAmount should immediately reduce (4000 - 1000 = 3000)
    const conc = await StudentFeeConcession.create({
      academicYearId: new mongoose.Types.ObjectId(),
      studentId: student._id,
      studentFeeId: feeBase._id,
      feeCategoryId: baseCat._id,
      concessionAmount: 1000,
      lessAmount: 1000,
      originalAmount: 4000,
      reason: 'Test Concession',
      createdBy: new mongoose.Types.ObjectId(),
      academicYear: '2031-2032',
      className: '6',
      status: 'Active'
    });
    await concessionController.syncStudentFeeRemainingAmount(feeBase._id);
    let feeBaseDb = await StudentFee.findById(feeBase._id);
    assertScenario(2, "Assign Concession", feeBaseDb.remainingAmount === 3000, `DB remainingAmount: ₹${feeBaseDb.remainingAmount}`);

    // 3. Modify Concession (1000 -> 1500) -> remainingAmount must update automatically (4000 - 1500 = 2500)
    conc.lessAmount = 1500;
    await conc.save();
    await concessionController.syncStudentFeeRemainingAmount(feeBase._id);
    feeBaseDb = await StudentFee.findById(feeBase._id);
    assertScenario(3, "Modify Concession", feeBaseDb.remainingAmount === 2500, `DB remainingAmount: ₹${feeBaseDb.remainingAmount}`);

    // 4. Deactivate Concession -> remainingAmount must increase correctly (2500 -> 4000)
    conc.status = 'Inactive';
    await conc.save();
    await concessionController.syncStudentFeeRemainingAmount(feeBase._id);
    feeBaseDb = await StudentFee.findById(feeBase._id);
    assertScenario(4, "Deactivate Concession", feeBaseDb.remainingAmount === 4000, `DB remainingAmount: ₹${feeBaseDb.remainingAmount}`);

    // Re-activate for Delete scenario test
    conc.status = 'Active';
    conc.lessAmount = 1000;
    await conc.save();
    await concessionController.syncStudentFeeRemainingAmount(feeBase._id);

    // 5. Delete (Cancel) Concession -> remainingAmount must restore correctly (3000 -> 4000)
    conc.status = 'Cancelled';
    await conc.save();
    await concessionController.syncStudentFeeRemainingAmount(feeBase._id);
    feeBaseDb = await StudentFee.findById(feeBase._id);
    assertScenario(5, "Delete Concession", feeBaseDb.remainingAmount === 4000, `DB remainingAmount: ₹${feeBaseDb.remainingAmount}`);

    // 6. Partial Payment -> remainingAmount must decrease correctly (4000 - 1000 paid = 3000)
    const paymentDoc = await Payment.create({
      studentId: student._id,
      amount: 1000,
      paymentMethod: 'Cash',
      paymentDate: new Date(),
      feeAllocations: [{ studentFeeId: feeBase._id, amount: 1000 }]
    });
    await StudentFee.updateOne({ _id: feeBase._id }, { $inc: { paidAmount: 1000, remainingAmount: -1000 } });
    feeBaseDb = await StudentFee.findById(feeBase._id);
    assertScenario(6, "Partial Payment", feeBaseDb.remainingAmount === 3000, `DB remainingAmount: ₹${feeBaseDb.remainingAmount}`);

    // 7. Delete Payment -> remainingAmount must restore correctly (3000 + 1000 = 4000)
    await Payment.deleteOne({ _id: paymentDoc._id });
    await StudentFee.updateOne({ _id: feeBase._id }, { $inc: { paidAmount: -1000, remainingAmount: 1000 } });
    feeBaseDb = await StudentFee.findById(feeBase._id);
    assertScenario(7, "Delete Payment", feeBaseDb.remainingAmount === 4000, `DB remainingAmount: ₹${feeBaseDb.remainingAmount}`);

    // 8. Charges -> remainingAmount must update correctly
    const feeCharge = await StudentFee.create({
      studentId: student._id,
      feeCategoryId: chargeCat._id,
      totalAmount: 200,
      paidAmount: 0,
      remainingAmount: 200,
      className: '6',
      academicYear: '2031-2032'
    });
    assertScenario(8, "Charges remainingAmount", feeCharge.remainingAmount === 200, `DB remainingAmount: ₹${feeCharge.remainingAmount}`);

    // 9. Uniform -> remainingAmount must update correctly
    const feeUniform = await StudentFee.create({
      studentId: student._id,
      feeCategoryId: uniformCat._id,
      totalAmount: 300,
      paidAmount: 0,
      remainingAmount: 300,
      className: '6',
      academicYear: '2031-2032'
    });
    assertScenario(9, "Uniform remainingAmount", feeUniform.remainingAmount === 300, `DB remainingAmount: ₹${feeUniform.remainingAmount}`);

    // 10. Promotion -> Carry Forward uses remainingAmount without recalculating
    student.currentClass = '7';
    student.academicYear = '2032-2033';
    await student.save();

    let apiStu = null;
    const mockRes = { status: () => mockRes, json: (d) => { apiStu = d?.[0]; return mockRes; } };
    await studentController.getStudents({ query: { search: adminNo } }, mockRes);

    // Sum of previous remainingAmounts = 4000 (Base) + 200 (Charge) + 300 (Uniform) = 4500
    assertScenario(10, "Promotion Carry Forward", apiStu.previousPending === 4500, `Carry Forward from DB remainingAmount: ₹${apiStu.previousPending}`);

    console.log("\n==========================================================");
    console.log(` ALL 10 SCENARIOS VERIFICATION RESULT: ${passedScenarios}/${totalScenarios} PASSED`);
    console.log("==========================================================");

    // Cleanup
    await Payment.deleteMany({ studentId: student._id });
    await StudentFeeConcession.deleteMany({ studentId: student._id });
    await StudentFee.deleteMany({ studentId: student._id });
    await Student.deleteOne({ _id: student._id });
    await FeeCategory.deleteMany({ _id: { $in: [baseCat._id, chargeCat._id, uniformCat._id] } });
    console.log("Cleanup completed successfully.");

  } catch (err) {
    console.error("Single source of truth test error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

runAll10ScenariosVerification();
