import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee, FeeCategory, StudentFeeConcession, Payment } from './src/models/index.js';
import * as paymentController from './src/controllers/paymentController.js';

dotenv.config();

async function debugPayment500() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.");

  try {
    const adminNo = "500-TEST-99";

    // Clean up
    const existing = await Student.findOne({ admissionNumber: adminNo });
    if (existing) {
      await Payment.deleteMany({ studentId: existing._id });
      await StudentFeeConcession.deleteMany({ studentId: existing._id });
      await StudentFee.deleteMany({ studentId: existing._id });
      await Student.deleteOne({ _id: existing._id });
    }

    const baseCat = await FeeCategory.create({ name: `P500_Base_${Date.now()}`, amount: 2500, mandatory: true, isEnabled: true });

    // Step 1: Create Student in Class 5 (2031-2032)
    const student = await Student.create({
      admissionNumber: adminNo,
      studentName: 'Debug Payment 500 Student',
      currentClass: '5',
      section: 'A',
      academicYear: '2031-2032',
      baseFee: 2500
    });

    const feePrev = await StudentFee.create({
      studentId: student._id,
      feeCategoryId: baseCat._id,
      totalAmount: 2500,
      paidAmount: 0,
      remainingAmount: 2500,
      className: '5',
      academicYear: '2031-2032'
    });

    // Step 2: Promote Student to Class 6 (2032-2033)
    student.currentClass = '6';
    student.academicYear = '2032-2033';
    await student.save();

    const feeCurr = await StudentFee.create({
      studentId: student._id,
      feeCategoryId: baseCat._id,
      totalAmount: 2000,
      paidAmount: 0,
      remainingAmount: 2000,
      className: '6',
      academicYear: '2032-2033'
    });

    console.log("\nAttempting createPayment for previous year pending fee (₹2500)...");

    const req = {
      user: { id: new mongoose.Types.ObjectId() },
      body: {
        studentId: student._id.toString(),
        studentFeeIds: [feePrev._id.toString()],
        amount: 2500,
        paymentMethod: 'Cash',
        feeAllocations: [{ studentFeeId: feePrev._id.toString(), amount: 2500 }]
      }
    };

    let responseCode = 200;
    let responseData = null;
    const res = {
      status: (code) => { responseCode = code; return res; },
      json: (data) => { responseData = data; return res; }
    };

    await paymentController.createPayment(req, res);

    console.log(`\nResponse Status: ${responseCode}`);
    console.log("Response Data:", responseData);

    // Cleanup
    await Payment.deleteMany({ studentId: student._id });
    await StudentFeeConcession.deleteMany({ studentId: student._id });
    await StudentFee.deleteMany({ studentId: student._id });
    await Student.deleteOne({ _id: student._id });
    await FeeCategory.deleteOne({ _id: baseCat._id });

  } catch (err) {
    console.error("\n❌ EXACT 500 ERROR STACK TRACE:");
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

debugPayment500();
