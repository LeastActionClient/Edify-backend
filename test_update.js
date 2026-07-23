import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee, FeeCategory } from './src/models/index.js';
import * as studentController from './src/controllers/studentController.js';

dotenv.config();

async function runTest() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB.");

  try {
    const student = await Student.findOne({ studentName: /thivya/i });
    if (!student) {
      console.log("Thivya not found!");
      return;
    }
    const studentId = student._id.toString();
    console.log(`\nBefore update - Thivya Class: ${student.currentClass}`);
    
    let beforeFees = await StudentFee.find({ studentId });
    let previousFees = beforeFees.filter(f => f.className !== student.currentClass);
    let previousPending = previousFees.reduce((sum, f) => sum + (f.remainingAmount || 0), 0);
    console.log(`Previous Pending Before: ${previousPending}`);

    const req = {
      user: { id: new mongoose.Types.ObjectId().toString() },
      params: { id: studentId },
      body: {
        admissionNumber: student.admissionNumber,
        studentName: student.studentName,
        currentClass: '7',
        section: 'A',
        academicYear: '2031-2032',
        baseFee: 0,
        grandTotal: 0,
        selectedFeeCategoryIds: []
      }
    };

    const res = {
      status: (code) => ({
        json: (data) => console.log(`Response [${code}]:`, data)
      }),
      json: (data) => console.log(`Response [200]:`, data)
    };

    console.log("Calling updateStudent...");
    await studentController.updateStudent(req, res);

    let afterFees = await StudentFee.find({ studentId });
    let previousFeesAfter = afterFees.filter(f => f.className !== '7');
    let previousPendingAfter = previousFeesAfter.reduce((sum, f) => sum + (f.remainingAmount || 0), 0);
    console.log(`Previous Pending After: ${previousPendingAfter}`);

    console.log("=== AFTER FEES ===");
    for (const f of afterFees) {
      console.log(`Fee: ${f._id} | Cat: ${f.feeCategoryId} | Class: ${f.className} | Year: ${f.academicYear} | Total: ${f.totalAmount} | Remain: ${f.remainingAmount}`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

runTest();
