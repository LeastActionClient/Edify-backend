import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee } from './src/models/index.js';
import * as studentController from './src/controllers/studentController.js';

dotenv.config();

async function runTest() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB.");

  try {
    const student = await Student.findOne({ studentName: /thivya/i });
    if (!student) {
      console.log("Thivya not found!");
      process.exit(1);
    }
    const studentId = student._id.toString();
    console.log(`Found Thivya: ${studentId}, Class: ${student.currentClass}, Section: ${student.section}, Year: ${student.academicYear}`);

    // Fetch before fees
    const beforeFees = await StudentFee.find({ studentId });
    console.log("=== BEFORE FEES ===");
    for (const f of beforeFees) {
      console.log(`Fee: ${f._id} | Cat: ${f.feeCategoryId} | Class: ${f.className} | Year: ${f.academicYear} | Total: ${f.totalAmount} | Remain: ${f.remainingAmount}`);
    }
    
    const previousFees = beforeFees.filter(f => f.className !== student.currentClass);
    const previousPending = previousFees.reduce((sum, f) => sum + (f.remainingAmount || 0), 0);
    console.log(`\nPrevious Pending Before: ${previousPending}`);

    // We will just invoke a simulated updateStudent
    // Actually, maybe we can just make a mock request/response object to call studentController.updateStudent
    const req = {
      params: { id: studentId },
      body: {
        currentClass: student.currentClass,
        academicYear: student.academicYear,
        // Let's pass selectedFeeCategoryIds for 7th standard
        // We will just fetch default fees for 7th std
      }
    };
    // ... wait, I don't know the exact fee categories for 7th std.
    // Let's just output the current data first to see if previousPending is already 500 or what.
  } catch (error) {
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected.");
  }
}

runTest();
