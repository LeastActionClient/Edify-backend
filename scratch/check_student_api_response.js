import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from '../src/utils/db.js';
import { Student, StudentFee } from '../src/models/index.js';
import { getStudentById } from '../src/controllers/studentController.js';

async function run() {
  await connectDB();
  const student = await Student.findOne({ studentName: /Nandhini Ravi/i });
  if (!student) {
    console.log('Nandhini Ravi not found.');
    mongoose.connection.close();
    return;
  }
  
  const mockReq = { params: { id: student._id.toString() } };
  let responseData = null;
  const mockRes = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.data = data;
      responseData = data;
      return this;
    }
  };

  await getStudentById(mockReq, mockRes);
  console.log('Student response data structure:');
  console.log('First studentFee entry:', JSON.stringify(responseData.studentFees?.[0], null, 2));

  mongoose.connection.close();
}
run();
