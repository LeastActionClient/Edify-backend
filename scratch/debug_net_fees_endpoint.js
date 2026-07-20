import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from '../src/utils/db.js';
import { Student, FeeCategory, StudentFee, StudentFeeConcession, Class, Section } from '../src/models/index.js';

async function run() {
  await connectDB();
  const student = await Student.findOne({ studentName: /Nandhini Ravi/i }).lean();
  if (!student) {
    console.log('Student not found.');
    mongoose.connection.close();
    return;
  }
  console.log('Student currentClass:', student.currentClass, 'section:', student.section);

  const allCategories = await FeeCategory.find({ isEnabled: true }).lean();
  console.log('Number of enabled categories:', allCategories.length);

  const studentFees = await StudentFee.find({ studentId: student._id }).populate('feeCategoryId').lean();
  console.log('Number of studentFees:', studentFees.length);

  const concessions = await StudentFeeConcession.find({ studentId: student._id }).lean();
  console.log('Number of concessions:', concessions.length);

  const classDoc = await Class.findOne({ name: student.currentClass }).lean();
  console.log('classDoc found:', !!classDoc);

  let sectionDoc = null;
  if (classDoc && student.section) {
    sectionDoc = await Section.findOne({ name: student.section, classId: classDoc._id }).lean();
  }
  console.log('sectionDoc found:', !!sectionDoc);

  const mergedDefaultFees = { ...(classDoc?.defaultFees || {}), ...(sectionDoc?.defaultFees || {}) };
  console.log('mergedDefaultFees keys:', Object.keys(mergedDefaultFees));

  const result = allCategories.map(cat => {
    const fee = studentFees.find(f => f.feeCategoryId?._id.toString() === cat._id.toString());
    const concession = concessions.find(c => 
      (fee && c.studentFeeId.toString() === fee._id.toString()) || 
      c.feeCategoryId.toString() === cat._id.toString()
    );
    return {
      catName: cat.name,
      catId: cat._id,
      feeFound: !!fee,
      concessionFound: !!concession
    };
  });
  console.log('Mapping result sample:', result);

  mongoose.connection.close();
}
run();
