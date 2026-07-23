import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee, StudentFeeConcession } from './src/models/index.js';

dotenv.config();

async function checkConcessions() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.");

  try {
    const student = await Student.findOne({ admissionNumber: 'ADM-004' });
    if (!student) return;

    const concessions = await StudentFeeConcession.find({ studentId: student._id }).populate('studentFeeId').populate('feeCategoryId').lean();
    console.log(`\n--- ALL CONCESSIONS FOR DHARIKHA (${concessions.length}) ---`);
    console.table(concessions.map(c => ({
      ConcessionID: c._id.toString(),
      FeeID: c.studentFeeId?._id?.toString(),
      FeeCategory: c.feeCategoryId?.name,
      Class: c.className,
      AcademicYear: c.academicYear,
      ConcessionAmount: c.concessionAmount,
      LessAmount: c.lessAmount,
      OriginalAmount: c.originalAmount,
      Status: c.status
    })));

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

checkConcessions();
