import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from '../src/utils/db.js';
import { Student } from '../src/models/index.js';
import { getStudentById } from '../src/controllers/studentController.js';

async function run() {
  await connectDB();
  const student = await Student.findOne({ admissionNumber: '562hbjn' }).lean();
  if (!student) {
    console.log('Student je not found.');
    mongoose.connection.close();
    return;
  }
  
  const mockReq = { params: { id: student._id.toString() } };
  let responseData = null;
  const mockRes = {
    status(code) { return this; },
    json(data) { responseData = data; return this; }
  };

  await getStudentById(mockReq, mockRes);
  console.log('Student je response data:');
  console.log('academicYear:', responseData.academicYear);
  console.log('Keys of response:', Object.keys(responseData));

  mongoose.connection.close();
}
run();
