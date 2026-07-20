import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import connectDB from '../src/utils/db.js';
import { Class } from '../src/models/index.js';

async function run() {
  await connectDB();
  const c = await Class.findOne();
  console.log('Sample Class Document:', JSON.stringify(c, null, 2));
  mongoose.connection.close();
}
run();
