import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee, FeeCategory } from './src/models/index.js';
import * as feeController from './src/controllers/feeController.js';

dotenv.config();

async function runMultiYearVerification() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB for Multi-Year Verification.");

  try {
    const testAdminNum = "TEST-REG-9999";

    // Clean up any existing test student
    const existingStudent = await Student.findOne({ admissionNumber: testAdminNum });
    if (existingStudent) {
      await StudentFee.deleteMany({ studentId: existingStudent._id });
      await Student.deleteOne({ _id: existingStudent._id });
    }

    // Step 1: Create a brand new unique Fee Category with amount = 1000
    const catName = `TestFee_${Date.now()}`;
    const testCat = await FeeCategory.create({ name: catName, amount: 1000, mandatory: false, isEnabled: true });

    // Step 2: Create Student in 5th Standard (2026-2027)
    const student = await Student.create({
      admissionNumber: testAdminNum,
      studentName: 'MultiYear Test Student',
      currentClass: '5',
      section: 'A',
      academicYear: '2026-2027',
      baseFee: 3000,
      grandTotal: 3000
    });

    const studentId = student._id.toString();

    // Create 5th Standard Fee
    await StudentFee.create({
      studentId: student._id,
      feeCategoryId: testCat._id,
      totalAmount: 3000,
      paidAmount: 0,
      remainingAmount: 3000,
      className: '5',
      academicYear: '2026-2027'
    });

    console.log("\n--- STAGE 1: 5th Standard Created ---");
    let fees5 = await StudentFee.find({ studentId });
    console.log(`5th Std Fee Count: ${fees5.length}`);

    // Step 3: Promote to 6th Standard (2027-2028)
    student.currentClass = '6';
    student.academicYear = '2027-2028';
    await student.save();

    await StudentFee.create({
      studentId: student._id,
      feeCategoryId: testCat._id,
      totalAmount: 2000,
      paidAmount: 0,
      remainingAmount: 2000,
      className: '6',
      academicYear: '2027-2028'
    });

    console.log("\n--- STAGE 2: Promoted to 6th Standard ---");
    let fees6 = await StudentFee.find({ studentId });
    console.log(`Total Fee Documents: ${fees6.length}`);

    // Step 4: Promote to 7th Standard (2028-2029) and call assignFeeToStudent API
    student.currentClass = '7';
    student.academicYear = '2028-2029';
    await student.save();

    console.log("\n--- STAGE 3: Promoted to 7th Standard (Before Assigning 7th Fee) ---");
    let prevFeesBefore7 = await StudentFee.find({ studentId, className: { $ne: '7' } });
    let prevPendingBefore7 = prevFeesBefore7.reduce((sum, f) => sum + f.remainingAmount, 0);
    console.log(`Previous Pending Dues: ₹${prevPendingBefore7}`);

    // Call assignFeeToStudent (Assign 7th Std Fee ₹1000)
    const mockReq = {
      user: { id: new mongoose.Types.ObjectId().toString() },
      params: { studentId: studentId },
      body: {
        feeCategoryId: testCat._id.toString(),
        totalAmount: 1000
      }
    };

    let resCode = 200;
    let resData = null;
    const mockRes = {
      status: (c) => { resCode = c; return mockRes; },
      json: (d) => { resData = d; return mockRes; }
    };

    await feeController.assignFeeToStudent(mockReq, mockRes);
    console.log(`assignFeeToStudent API Status Code: ${resCode}`);

    console.log("\n--- STAGE 4: After assignFeeToStudent (Assigned 7th Fee) ---");
    let allFeesAfter7 = await StudentFee.find({ studentId });
    let prevFeesAfter7 = allFeesAfter7.filter(f => f.className !== '7');
    let currFeesAfter7 = allFeesAfter7.filter(f => f.className === '7');

    let prevPendingAfter7 = prevFeesAfter7.reduce((sum, f) => sum + f.remainingAmount, 0);
    let currPendingAfter7 = currFeesAfter7.reduce((sum, f) => sum + f.remainingAmount, 0);

    console.log(`Previous Pending Dues: ₹${prevPendingAfter7} (Expected: ₹5000)`);
    console.log(`Current Pending Dues (7th Std): ₹${currPendingAfter7} (Expected: ₹1000)`);
    console.log(`Total Dues: ₹${prevPendingAfter7 + currPendingAfter7} (Expected: ₹6000)`);

    console.log("\nDetailed Fee Records breakdown:");
    for (const f of allFeesAfter7) {
      console.log(`  - Record ID: ${f._id} | Class: ${f.className} | Year: ${f.academicYear} | Total: ₹${f.totalAmount} | Remaining: ₹${f.remainingAmount}`);
    }

    // Step 5: Promote to 8th Standard (2029-2030)
    student.currentClass = '8';
    student.academicYear = '2029-2030';
    await student.save();

    const mockReq8 = {
      user: { id: new mongoose.Types.ObjectId().toString() },
      params: { studentId: studentId },
      body: {
        feeCategoryId: testCat._id.toString(),
        totalAmount: 1500
      }
    };

    await feeController.assignFeeToStudent(mockReq8, mockRes);

    console.log("\n--- STAGE 5: Promoted to 8th Standard & Assigned 8th Fee ---");
    let allFeesFinal = await StudentFee.find({ studentId });
    let prevFeesFinal = allFeesFinal.filter(f => f.className !== '8');
    let currFeesFinal = allFeesFinal.filter(f => f.className === '8');

    let prevPendingFinal = prevFeesFinal.reduce((sum, f) => sum + f.remainingAmount, 0);
    let currPendingFinal = currFeesFinal.reduce((sum, f) => sum + f.remainingAmount, 0);

    console.log(`Total Distinct Fee Documents Across 4 Years: ${allFeesFinal.length}`);
    console.log(`Previous Pending Dues: ₹${prevPendingFinal} (Expected: ₹6000)`);
    console.log(`Current Dues (8th Std): ₹${currPendingFinal} (Expected: ₹1500)`);
    console.log(`Grand Total Dues Across All 4 Years: ₹${prevPendingFinal + currPendingFinal} (Expected: ₹7500)`);

    // Verification Assertions
    const isIsolated = allFeesFinal.length === 4 && prevPendingAfter7 === 5000 && currPendingAfter7 === 1000 && prevPendingFinal === 6000 && currPendingFinal === 1500;
    if (isIsolated) {
      console.log("\n=======================================================");
      console.log(" SUCCESS: MULTI-YEAR VERIFICATION & FINANCIAL ISOLATION PASSED PERFECTLY!");
      console.log("=======================================================");
    } else {
      console.error("\n FAILED VERIFICATION: Financial records were mutated or not isolated properly.");
    }

    // Clean up
    await StudentFee.deleteMany({ studentId });
    await Student.deleteOne({ _id: student._id });
    await FeeCategory.deleteOne({ _id: testCat._id });
    console.log("Cleanup completed successfully.");

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await mongoose.disconnect();
  }
}

runMultiYearVerification();
