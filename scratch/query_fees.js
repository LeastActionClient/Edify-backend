import dotenv from 'dotenv';
import connectDB from '../src/utils/db.js';
import mongoose from 'mongoose';
import { Student, StudentFee, FeeCategory } from '../src/models/index.js';

dotenv.config();

async function main() {
  await connectDB();

  console.log('=== COUNT OF COLLECTIONS ===');
  console.log('Students count:', await Student.countDocuments());
  console.log('StudentFees count:', await StudentFee.countDocuments());
  console.log('FeeCategories count:', await FeeCategory.countDocuments());

  console.log('\n=== SAMPLE STUDENT ===');
  const sampleStudent = await Student.findOne();
  if (sampleStudent) {
    console.log(JSON.stringify(sampleStudent, null, 2));
  } else {
    console.log('No students found');
  }

  console.log('\n=== SAMPLE STUDENT FEE ===');
  const sampleFee = await StudentFee.findOne().populate('feeCategoryId');
  if (sampleFee) {
    console.log(JSON.stringify(sampleFee, null, 2));
  } else {
    console.log('No student fees found');
  }

  mongoose.connection.close();
}

main().catch(err => {
  console.error(err);
  mongoose.connection.close();
});
