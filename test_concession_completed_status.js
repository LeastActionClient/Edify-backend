import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee, FeeCategory, StudentFeeConcession, Payment } from './src/models/index.js';
import * as paymentController from './src/controllers/paymentController.js';
import * as concessionController from './src/controllers/concessionController.js';

dotenv.config();

async function testConcessionCompletedStatus() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("==========================================================");
  console.log(" TESTING CONCESSION 'Completed' STATUS ENUM VALIDATION");
  console.log("==========================================================");

  try {
    const adminNo = "CONC-COMP-100";

    // Clean up
    const existing = await Student.findOne({ admissionNumber: adminNo });
    if (existing) {
      await Payment.deleteMany({ studentId: existing._id });
      await StudentFeeConcession.deleteMany({ studentId: existing._id });
      await StudentFee.deleteMany({ studentId: existing._id });
      await Student.deleteOne({ _id: existing._id });
    }

    const baseCat = await FeeCategory.create({ name: `ConcComp_Base_${Date.now()}`, amount: 2000, mandatory: true, isEnabled: true });

    // Step 1: Create Student & Fee
    const student = await Student.create({
      admissionNumber: adminNo,
      studentName: 'Concession Completed Test Student',
      currentClass: '6',
      academicYear: '2034-2035'
    });

    const fee = await StudentFee.create({
      studentId: student._id,
      feeCategoryId: baseCat._id,
      totalAmount: 2000,
      paidAmount: 0,
      remainingAmount: 1000, // 2000 - 1000 concession
      className: '6',
      academicYear: '2034-2035'
    });

    // Step 2: Create Active Concession of ₹1000
    const conc = await StudentFeeConcession.create({
      academicYearId: new mongoose.Types.ObjectId(),
      studentId: student._id,
      studentFeeId: fee._id,
      feeCategoryId: baseCat._id,
      concessionAmount: 1000,
      lessAmount: 1000,
      originalAmount: 2000,
      reason: 'Special Concession',
      createdBy: new mongoose.Types.ObjectId(),
      academicYear: '2034-2035',
      className: '6',
      status: 'Active'
    });

    console.log("Active Concession created. Remaining balance = ₹1000.");

    // Step 3: Record Full Payment of net ₹1000 (which will trigger relatedConcession.status = 'Completed')
    const req = {
      user: { id: new mongoose.Types.ObjectId() },
      body: {
        studentId: student._id.toString(),
        studentFeeIds: [fee._id.toString()],
        amount: 1000,
        paymentMethod: 'Cash',
        feeAllocations: [{ studentFeeId: fee._id.toString(), amount: 1000 }]
      }
    };

    let resCode = 200;
    let resData = null;
    const res = { status: (c) => { resCode = c; return res; }, json: (d) => { resData = d; return res; } };

    await paymentController.createPayment(req, res);

    console.log(`Payment API Response Status: ${resCode}`);

    // Verify Concession Status in DB
    const updatedConc = await StudentFeeConcession.findById(conc._id);
    console.log(`Updated Concession Status in MongoDB: '${updatedConc.status}'`);

    if (resCode === 201 && updatedConc.status === 'Completed') {
      console.log("\n=======================================================");
      console.log(" 🎉 SUCCESS: CONCESSION TRANSITIONED TO 'Completed' CLEANLY WITHOUT ENUM ERROR!");
      console.log("=======================================================");
    } else {
      console.error("\n❌ TEST FAILED:", resData);
    }

    // Cleanup
    await Payment.deleteMany({ studentId: student._id });
    await StudentFeeConcession.deleteMany({ studentId: student._id });
    await StudentFee.deleteMany({ studentId: student._id });
    await Student.deleteOne({ _id: student._id });
    await FeeCategory.deleteOne({ _id: baseCat._id });

  } catch (err) {
    console.error("Test error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

testConcessionCompletedStatus();
