import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee, FeeCategory, Class } from './src/models/index.js';
import * as studentController from './src/controllers/studentController.js';
import * as feeController from './src/controllers/feeController.js';

dotenv.config();

async function verifyThivyaRealWorkflow() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB for Real Application Workflow Verification.");

  try {
    // 1. Locate student Thivya
    const student = await Student.findOne({ studentName: /thivya/i });
    if (!student) {
      console.error("Student 'Thivya' not found in database!");
      return;
    }

    const studentId = student._id.toString();
    console.log(`\n======================================================`);
    console.log(`REAL STUDENT LOCATED: ${student.studentName} (${student.admissionNumber})`);
    console.log(`Current Class: ${student.currentClass} | Current Academic Year: ${student.academicYear}`);
    console.log(`======================================================\n`);

    // CAPTURE BEFORE STATE
    let beforeFees = await StudentFee.find({ studentId }).lean();
    console.log("--- BEFORE ASSIGNING NEW CLASS FEES: ALL STUDENT FEES ---");
    console.table(beforeFees.map(f => ({
      ID: f._id.toString(),
      Class: f.className || 'NULL',
      AcademicYear: f.academicYear || 'NULL',
      TotalAmount: f.totalAmount,
      PaidAmount: f.paidAmount,
      RemainingAmount: f.remainingAmount
    })));

    const prevFeesBefore = beforeFees.filter(f => f.className !== student.currentClass);
    const currFeesBefore = beforeFees.filter(f => f.className === student.currentClass);

    const prevPendingBefore = prevFeesBefore.reduce((sum, f) => sum + (f.remainingAmount || 0), 0);
    const currPendingBefore = currFeesBefore.reduce((sum, f) => sum + (f.remainingAmount || 0), 0);

    console.log(`\nBEFORE UPDATE METRICS:`);
    console.log(`  Previous Pending Dues : ₹${prevPendingBefore}`);
    console.log(`  Current Pending Dues  : ₹${currPendingBefore}`);
    console.log(`  Total Pending Dues    : ₹${prevPendingBefore + currPendingBefore}\n`);

    // Find an existing fee category (or Base Fee)
    let feeCat = await FeeCategory.findOne({ isEnabled: true });

    // CALL assignFeeToStudent (Assign Fee Workflow)
    const assignFeeReq = {
      user: { id: new mongoose.Types.ObjectId().toString() },
      params: { studentId: studentId },
      body: {
        feeCategoryId: feeCat._id.toString(),
        totalAmount: 1000
      }
    };

    let resStatusCode = 200;
    let resData = null;
    const mockRes = {
      status: (code) => { resStatusCode = code; return mockRes; },
      json: (data) => { resData = data; return mockRes; }
    };

    console.log("--- EXECUTING ASSIGN FEE WORKFLOW (assignFeeToStudent) ---");
    await feeController.assignFeeToStudent(assignFeeReq, mockRes);
    console.log(`assignFeeToStudent Response Status: ${resStatusCode}`);

    // CAPTURE AFTER STATE
    let afterFees = await StudentFee.find({ studentId }).lean();
    console.log("\n--- AFTER ASSIGNING NEW CLASS FEES: ALL STUDENT FEES ---");
    console.table(afterFees.map(f => ({
      ID: f._id.toString(),
      Class: f.className || 'NULL',
      AcademicYear: f.academicYear || 'NULL',
      TotalAmount: f.totalAmount,
      PaidAmount: f.paidAmount,
      RemainingAmount: f.remainingAmount
    })));

    const prevFeesAfter = afterFees.filter(f => f.className !== student.currentClass);
    const currFeesAfter = afterFees.filter(f => f.className === student.currentClass);

    const prevPendingAfter = prevFeesAfter.reduce((sum, f) => sum + (f.remainingAmount || 0), 0);
    const currPendingAfter = currFeesAfter.reduce((sum, f) => sum + (f.remainingAmount || 0), 0);

    console.log(`\nAFTER UPDATE METRICS:`);
    console.log(`  Previous Pending Dues : ₹${prevPendingAfter} (Expected: ₹${prevPendingBefore})`);
    console.log(`  Current Pending Dues  : ₹${currPendingAfter} (Expected: ₹1000)`);
    console.log(`  Total Pending Dues    : ₹${prevPendingAfter + currPendingAfter}\n`);

    // DETAILED HISTORICAL AUDIT COMPARISON
    console.log("=======================================================");
    console.log(" HISTORICAL DOCUMENT IMMUTABILITY AUDIT");
    console.log("=======================================================");

    let mutationDetected = false;
    for (const bFee of beforeFees) {
      const match = afterFees.find(a => a._id.toString() === bFee._id.toString());
      if (!match) {
        console.error(`❌ CRITICAL FAILURE: Historical document ${bFee._id} WAS DELETED!`);
        mutationDetected = true;
      } else {
        const classMatch = match.className === bFee.className;
        const yearMatch = match.academicYear === bFee.academicYear;
        const totalMatch = match.totalAmount === bFee.totalAmount;
        const paidMatch = match.paidAmount === bFee.paidAmount;
        const remainMatch = match.remainingAmount === bFee.remainingAmount;

        if (classMatch && yearMatch && totalMatch && paidMatch && remainMatch) {
          console.log(`✅ UNTOUCHED: ID ${bFee._id} | Class ${bFee.className} | Year ${bFee.academicYear} | Total ₹${bFee.totalAmount} | Paid ₹${bFee.paidAmount} | Rem ₹${bFee.remainingAmount}`);
        } else {
          console.error(`❌ MUTATION DETECTED on ID ${bFee._id}:`);
          console.error(`   Before: Class=${bFee.className}, Year=${bFee.academicYear}, Total=${bFee.totalAmount}, Remain=${bFee.remainingAmount}`);
          console.error(`   After : Class=${match.className}, Year=${match.academicYear}, Total=${match.totalAmount}, Remain=${match.remainingAmount}`);
          mutationDetected = true;
        }
      }
    }

    const createdDocs = afterFees.filter(a => !beforeFees.some(b => b._id.toString() === a._id.toString()));
    console.log(`\nNEWLY CREATED DOCUMENTS FOR CLASS ${student.currentClass}: ${createdDocs.length}`);
    for (const c of createdDocs) {
      console.log(`✨ NEW DOCUMENT: ID ${c._id} | Class ${c.className} | Year ${c.academicYear} | Total ₹${c.totalAmount} | Remaining ₹${c.remainingAmount}`);
    }

    const prevPendingUnchanged = prevPendingBefore === prevPendingAfter;

    if (!mutationDetected && prevPendingUnchanged && createdDocs.length > 0) {
      console.log("\n=======================================================");
      console.log(" 🎉 REAL WORKFLOW VERIFICATION PASSED PERFECTLY!");
      console.log("=======================================================");
    } else {
      console.error("\n❌ REAL WORKFLOW VERIFICATION FAILED!");
    }

    // CLEANUP created test fee for Thivya so DB state remains clean
    if (createdDocs.length > 0) {
      for (const c of createdDocs) {
        await StudentFee.deleteOne({ _id: c._id });
      }
      console.log("\nCleaned up temporary 7th standard fee document after verification.");
    }

  } catch (err) {
    console.error("Verification failed:", err);
  } finally {
    await mongoose.disconnect();
  }
}

verifyThivyaRealWorkflow();
