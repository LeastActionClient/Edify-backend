import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from '../src/utils/db.js';
import { Student } from '../src/models/index.js';
import { getStudentById } from '../src/controllers/studentController.js';
import { getStudentNetFees } from '../src/controllers/concessionController.js';

async function run() {
  await connectDB();
  const student = await Student.findOne({ studentName: /Nandhini Ravi/i });
  if (!student) {
    console.log('Nandhini Ravi not found.');
    mongoose.connection.close();
    return;
  }

  // Fetch Student JSON
  let studentData = null;
  const mockStudentRes = {
    status(code) { return this; },
    json(data) { studentData = data; return this; }
  };
  await getStudentById({ params: { id: student._id.toString() } }, mockStudentRes);

  // Fetch Concessions JSON
  let concessionsData = null;
  const mockConcRes = {
    status(code) { return this; },
    json(data) { concessionsData = data; return this; }
  };
  await getStudentNetFees({ params: { studentId: student._id.toString() } }, mockConcRes);

  console.log('--- simulate FE mapping logic ---');
  const netFees = concessionsData.result || [];
  console.log('netFees keys:', netFees.map(nf => ({ key: nf.feeCategoryId, type: typeof nf.feeCategoryId })));

  const netFeeMap = new Map(netFees.map(nf => [nf.feeCategoryId.toString(), nf]));
  
  studentData.studentFees.forEach(f => {
    const lookupKey = (f.feeCategoryId?._id || f.feeCategoryId || '').toString();
    const netFee = netFeeMap.get(lookupKey);
    console.log(`Lookup key: "${lookupKey}" for category "${f.feeCategory?.name || f.feeCategoryId?.name}" -> netFee found?`, !!netFee);
    if (netFee) {
      console.log('  Found concession status:', netFee.concessionStatus, 'lessAmount:', netFee.lessAmount);
    }
  });

  mongoose.connection.close();
}
run();
