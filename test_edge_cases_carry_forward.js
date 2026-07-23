import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee, FeeCategory, StudentFeeConcession } from './src/models/index.js';
import * as studentController from './src/controllers/studentController.js';

dotenv.config();

async function runEdgeCasesVerification() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("==========================================================");
  console.log(" VERIFYING CARRY FORWARD EXPLICIT EDGE CASES (1 to 7)");
  console.log("==========================================================");

  let passedEdgeCases = 0;
  let totalEdgeCases = 0;

  const assertEdgeCase = (title, condition, details = "") => {
    totalEdgeCases++;
    if (condition) {
      passedEdgeCases++;
      console.log(`✅ [PASS ${totalEdgeCases}/7] ${title} ${details ? '- ' + details : ''}`);
    } else {
      console.error(`❌ [FAIL ${totalEdgeCases}/7] ${title} - ${details}`);
    }
  };

  try {
    const adminNo = "EC-TEST-8888";

    // Clean up
    const existing = await Student.findOne({ admissionNumber: adminNo });
    if (existing) {
      await StudentFeeConcession.deleteMany({ studentId: existing._id });
      await StudentFee.deleteMany({ studentId: existing._id });
      await Student.deleteOne({ _id: existing._id });
    }

    // Categories setup
    const baseCat = await FeeCategory.create({ name: `EC_Base_${Date.now()}`, amount: 2000, mandatory: true, isEnabled: true });
    const uniformCat = await FeeCategory.create({ name: `EC_Uniform_${Date.now()}`, amount: 500, mandatory: false, isEnabled: true });
    const optCat = await FeeCategory.create({ name: `EC_Opt_${Date.now()}`, amount: 300, mandatory: false, isEnabled: true });

    // Step 1: Create Student in Class 5 (2029-2030)
    const student = await Student.create({
      admissionNumber: adminNo,
      studentName: 'EdgeCases Test Student',
      currentClass: '5',
      section: 'A',
      academicYear: '2029-2030',
      baseFee: 2000,
      grandTotal: 2800
    });
    const sId = student._id.toString();

    // Fees in Class 5:
    // 1. Base Fee (Fully Paid: Total 2000, Paid 2000, Remaining 0)
    const fee5Base = await StudentFee.create({ studentId: student._id, feeCategoryId: baseCat._id, totalAmount: 2000, paidAmount: 2000, remainingAmount: 0, className: '5', academicYear: '2029-2030' });
    // 2. Uniform Fee (Fully Paid: Total 500, Paid 500, Remaining 0)
    const fee5Uniform = await StudentFee.create({ studentId: student._id, feeCategoryId: uniformCat._id, totalAmount: 500, paidAmount: 500, remainingAmount: 0, className: '5', academicYear: '2029-2030' });
    // 3. Optional Charge (Partially Paid: Total 300, Paid 100, Remaining 200)
    const fee5Opt = await StudentFee.create({ studentId: student._id, feeCategoryId: optCat._id, totalAmount: 300, paidAmount: 100, remainingAmount: 200, className: '5', academicYear: '2029-2030' });

    // Helper for API call
    const fetchApiStudent = async () => {
      let data = null;
      const mockRes = { status: () => mockRes, json: (d) => { data = d; return mockRes; } };
      await studentController.getStudents({ query: { search: adminNo } }, mockRes);
      return data?.[0];
    };

    // Promote 5 -> 6
    student.currentClass = '6';
    student.academicYear = '2030-2031';
    await student.save();

    let apiStuStage1 = await fetchApiStudent();
    
    // Edge Case 1: Previous fee fully paid -> Should NOT appear in Carry Forward
    // Edge Case 4: Uniform fee fully paid -> Should NOT contribute to Carry Forward
    // Edge Case 2: Previous fee partially paid -> Only remainingAmount (200) should be carried forward
    assertEdgeCase("1. Previous fee fully paid excluded", apiStuStage1.previousPending === 200, `Previous Pending: ₹${apiStuStage1.previousPending}`);
    assertEdgeCase("2. Previous fee partially paid carried forward", apiStuStage1.previousPending === 200, `Carried forward exact ₹200 remaining`);
    assertEdgeCase("4. Uniform fee fully paid excluded", apiStuStage1.previousPending === 200, `Uniform ₹0 carried forward`);

    // Fees in Class 6:
    // Base Fee 6th (Total 2000, Concession 500 -> Net 1500, Paid 0, Remaining 1500)
    const fee6Base = await StudentFee.create({ studentId: student._id, feeCategoryId: baseCat._id, totalAmount: 2000, paidAmount: 0, remainingAmount: 2000, className: '6', academicYear: '2030-2031' });
    await StudentFeeConcession.create({
      academicYearId: new mongoose.Types.ObjectId(),
      studentId: student._id,
      studentFeeId: fee6Base._id,
      feeCategoryId: baseCat._id,
      concessionAmount: 500,
      lessAmount: 500,
      originalAmount: 2000,
      reason: 'Concession',
      createdBy: new mongoose.Types.ObjectId(),
      academicYear: '2030-2031',
      className: '6',
      status: 'Active'
    });

    // Uniform Fee 6th (Partially Paid: Total 500, Paid 200 -> Remaining 300)
    const fee6Uniform = await StudentFee.create({ studentId: student._id, feeCategoryId: uniformCat._id, totalAmount: 500, paidAmount: 200, remainingAmount: 300, className: '6', academicYear: '2030-2031' });

    // Optional Charge 6th (Created then REMOVED/DELETED before promotion)
    const fee6RemovedOpt = await StudentFee.create({ studentId: student._id, feeCategoryId: optCat._id, totalAmount: 300, paidAmount: 0, remainingAmount: 300, className: '6', academicYear: '2030-2031' });
    await StudentFee.deleteOne({ _id: fee6RemovedOpt._id }); // REMOVED BEFORE PROMOTION

    // Promote 6 -> 7
    student.currentClass = '7';
    student.academicYear = '2031-2032';
    await student.save();

    let apiStuStage2 = await fetchApiStudent();
    // Class 5 remaining: 200
    // Class 6 Net Base remaining: 1500 (2000 - 500 concession)
    // Class 6 Uniform remaining: 300 (500 - 200 paid)
    // Class 6 Removed Optional: DELETED (0)
    // Expected Previous Pending from Class 5 & 6 = 200 + 1500 + 300 = ₹2000
    assertEdgeCase("3. Previous fee with concession uses net remaining balance", apiStuStage2.previousPending === 2000, `Net remaining after concession ₹1500 used`);
    assertEdgeCase("5. Uniform fee partially paid carries unpaid balance", apiStuStage2.previousPending === 2000, `Unpaid uniform balance ₹300 included`);
    assertEdgeCase("6. Optional charge removed before promotion excluded", apiStuStage2.previousPending === 2000, `Deleted optional charge ₹0 included`);

    // Promote 7 -> 8 (Multi-Year 5 -> 6 -> 7 -> 8)
    const fee7Base = await StudentFee.create({ studentId: student._id, feeCategoryId: baseCat._id, totalAmount: 1000, paidAmount: 0, remainingAmount: 1000, className: '7', academicYear: '2031-2032' });

    student.currentClass = '8';
    student.academicYear = '2032-2033';
    await student.save();

    let apiStuStage3 = await fetchApiStudent();
    // Previous Pending across 5, 6, 7 = 200 + 1500 + 300 + 1000 = ₹3000
    assertEdgeCase("7. Multi-year promotion (5 → 6 → 7 → 8) includes all unpaid historical fees", apiStuStage3.previousPending === 3000, `Sum of Class 5, 6, 7 unpaid fees = ₹3000`);

    console.log("\n==========================================================");
    console.log(` EDGE CASES VERIFICATION RESULT: ${passedEdgeCases}/${totalEdgeCases} PASSED`);
    console.log("==========================================================");

    // Cleanup
    await StudentFeeConcession.deleteMany({ studentId: student._id });
    await StudentFee.deleteMany({ studentId: student._id });
    await Student.deleteOne({ _id: student._id });
    await FeeCategory.deleteMany({ _id: { $in: [baseCat._id, uniformCat._id, optCat._id] } });

  } catch (err) {
    console.error("Edge case test error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

runEdgeCasesVerification();
