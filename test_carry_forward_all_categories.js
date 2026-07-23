import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee, FeeCategory } from './src/models/index.js';
import * as studentController from './src/controllers/studentController.js';

dotenv.config();

async function runCarryForwardCategoryTest() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB for Carry Forward All Categories Verification.");

  try {
    const adminNo = "CF-TEST-9999";

    // Clean up test student
    const existing = await Student.findOne({ admissionNumber: adminNo });
    if (existing) {
      await StudentFee.deleteMany({ studentId: existing._id });
      await Student.deleteOne({ _id: existing._id });
    }

    // Step 1: Create Categories
    let baseCat = await FeeCategory.create({ name: `CF_Base_${Date.now()}`, amount: 4000, mandatory: true, isEnabled: true });
    let beltCat = await FeeCategory.create({ name: `CF_Belt_${Date.now()}`, amount: 100, mandatory: false, isEnabled: true });
    let noteCat = await FeeCategory.create({ name: `CF_Note_${Date.now()}`, amount: 100, mandatory: false, isEnabled: true });
    let uniformCat = await FeeCategory.create({ name: `CF_Uniform_${Date.now()}`, amount: 20, mandatory: false, isEnabled: true });

    // Step 2: Create Student in Class 6 (2031-2032)
    const student = await Student.create({
      admissionNumber: adminNo,
      studentName: 'CarryForward All Categories Student',
      currentClass: '6',
      section: 'A',
      academicYear: '2031-2032',
      baseFee: 4000,
      grandTotal: 4220
    });

    const sId = student._id.toString();

    // Create Class 6 Unpaid StudentFee Records Across ALL Categories
    // Base Fee: 4000
    await StudentFee.create({ studentId: student._id, feeCategoryId: baseCat._id, totalAmount: 4000, paidAmount: 0, remainingAmount: 4000, className: '6', academicYear: '2031-2032' });
    // Belt: 100
    await StudentFee.create({ studentId: student._id, feeCategoryId: beltCat._id, totalAmount: 100, paidAmount: 0, remainingAmount: 100, className: '6', academicYear: '2031-2032' });
    // Note: 100
    await StudentFee.create({ studentId: student._id, feeCategoryId: noteCat._id, totalAmount: 100, paidAmount: 0, remainingAmount: 100, className: '6', academicYear: '2031-2032' });
    // Uniform: 20
    await StudentFee.create({ studentId: student._id, feeCategoryId: uniformCat._id, totalAmount: 20, paidAmount: 0, remainingAmount: 20, className: '6', academicYear: '2031-2032' });

    console.log("\n--- STAGE 1: Class 6 Fees Created ---");
    console.log(`Base Fee: ₹4000 | Belt: ₹100 | Note: ₹100 | Uniform: ₹20`);
    console.log(`Total Unpaid Class 6 Dues: ₹4220`);

    // Step 3: Promote Student to Class 7 (2032-2033)
    student.currentClass = '7';
    student.academicYear = '2032-2033';
    await student.save();

    // Assign Class 7 Fee ₹1000
    await StudentFee.create({ studentId: student._id, feeCategoryId: baseCat._id, totalAmount: 1000, paidAmount: 0, remainingAmount: 1000, className: '7', academicYear: '2032-2033' });

    console.log("\n--- STAGE 2: Promoted to Class 7 & Assigned Class 7 Fee ---");

    // Fetch getStudents output from backend
    const mockRes = () => {
      let code = 200, data = null;
      const res = {
        status: (c) => { code = c; return res; },
        json: (d) => { data = d; return res; }
      };
      return { res, getCode: () => code, getData: () => data };
    };

    const r = mockRes();
    await studentController.getStudents({ query: { search: adminNo } }, r.res);

    const fetchedStudent = r.getData()?.[0];
    console.log(`\nBackend API getStudents Output for ${fetchedStudent.studentName}:`);
    console.log(`  - Previous Pending Dues : ₹${fetchedStudent.previousPending} (Expected: ₹4220)`);
    console.log(`  - Current Pending Dues  : ₹${fetchedStudent.currentPending} (Expected: ₹1000)`);
    console.log(`  - Total Pending Dues    : ₹${fetchedStudent.totalDue} (Expected: ₹5220)`);

    const isPassed = fetchedStudent.previousPending === 4220 && fetchedStudent.currentPending === 1000;

    if (isPassed) {
      console.log("\n=======================================================");
      console.log(" 🎉 SUCCESS: CARRY FORWARD INCLUDES ALL UNPAID FEE CATEGORIES!");
      console.log("=======================================================");
    } else {
      console.error(`\n❌ FAILURE: Expected Previous Pending ₹4220, got ₹${fetchedStudent.previousPending}`);
    }

    // Cleanup
    await StudentFee.deleteMany({ studentId: student._id });
    await Student.deleteOne({ _id: student._id });
    await FeeCategory.deleteMany({ _id: { $in: [baseCat._id, beltCat._id, noteCat._id, uniformCat._id] } });
    console.log("Cleanup completed successfully.");

  } catch (err) {
    console.error("Test error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

runCarryForwardCategoryTest();
