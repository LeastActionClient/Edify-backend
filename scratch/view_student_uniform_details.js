import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from '../src/utils/db.js';
import { Student } from '../src/models/index.js';

async function run() {
  await connectDB();
  const student = await Student.findOne({ studentName: /Sneha Babu/i });
  if (student) {
    console.log('Sneha Babu Student Document:', JSON.stringify(student, null, 2));
  } else {
    console.log('Sneha Babu not found.');
  }
  mongoose.connection.close();
}
run();
