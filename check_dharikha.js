import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee, FeeCategory, StudentIncludedCharge, IncludedCharge } from './src/models/index.js';

dotenv.config();

async function checkDharikha() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB for Dharikha Audit.");

  try {
    const student = await Student.findOne({ $or: [{ admissionNumber: 'ADM-004' }, { studentName: /dharikha/i }] });
    if (!student) {
      console.error("Student Dharikha (ADM-004) not found!");
      return;
    }

    console.log(`\n======================================================`);
    console.log(`STUDENT: ${student.studentName} (${student.admissionNumber})`);
    console.log(`Current Class: ${student.currentClass} | Current Academic Year: ${student.academicYear}`);
    console.log(`Base Fee: ${student.baseFee} | Grand Total: ${student.grandTotal}`);
    console.log(`Included Charges Total: ${student.includedChargesTotal} | Activities Total: ${student.activitiesTotal}`);
    console.log(`======================================================\n`);

    // Fetch ALL StudentFee documents for Dharikha
    const allFees = await StudentFee.find({ studentId: student._id }).populate('feeCategoryId').lean();
    console.log("--- ALL StudentFee DOCUMENTS FOR DHARIKHA ---");
    console.table(allFees.map(f => ({
      FeeID: f._id.toString(),
      CategoryName: f.feeCategoryId?.name || 'NO_CAT',
      CatID: f.feeCategoryId?._id?.toString() || 'NULL',
      Class: f.className || 'NULL',
      AcademicYear: f.academicYear || 'NULL',
      TotalAmount: f.totalAmount,
      PaidAmount: f.paidAmount,
      RemainingAmount: f.remainingAmount
    })));

    // Fetch previousClassFees vs currentClassFees logic as done in getStudents
    const currentClassFees = allFees.filter(f =>
      f.className === student.currentClass || (!f.className && !f.academicYear)
    );
    const previousClassFees = allFees.filter(f =>
      f.className && f.className !== student.currentClass
    );

    console.log("\n--- PREVIOUS CLASS FEES ( className !== currentClass ) ---");
    console.table(previousClassFees.map(f => ({
      FeeID: f._id.toString(),
      CategoryName: f.feeCategoryId?.name || 'NO_CAT',
      Class: f.className,
      AcademicYear: f.academicYear,
      TotalAmount: f.totalAmount,
      RemainingAmount: f.remainingAmount
    })));

    const previousPending = previousClassFees.reduce((sum, f) => sum + (f.remainingAmount || 0), 0);
    const currentPending = currentClassFees.reduce((sum, f) => sum + (f.remainingAmount || 0), 0);

    console.log(`\nCOMPUTED METRICS FROM getStudents:`);
    console.log(`  Previous Pending Dues : ₹${previousPending}`);
    console.log(`  Current Pending Dues  : ₹${currentPending}`);
    console.log(`  Total Pending Dues    : ₹${previousPending + currentPending}`);

    // Check Included Charges & Activities tables to see if charges/uniform are stored outside StudentFee
    const includedCharges = await StudentIncludedCharge.find({ studentId: student._id }).populate('includedChargeId').lean();
    console.log(`\n--- StudentIncludedCharge RECORDS (${includedCharges.length}) ---`);
    for (const ic of includedCharges) {
      console.log(`  - Charge ID: ${ic.includedChargeId?._id} | Name: ${ic.includedChargeId?.name} | Amount: ${ic.includedChargeId?.amount}`);
    }

  } catch (err) {
    console.error("Audit error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

checkDharikha();
