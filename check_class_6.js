import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Class, Section } from './src/models/index.js';

dotenv.config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const class6 = await Class.findOne({ name: '6' }).lean();
  console.log("=== Class 6 ===");
  console.log("Name:", class6?.name);
  console.log("Default Fees:", class6?.defaultFees);

  const secA = await Section.findOne({ name: 'A', classId: class6?._id }).lean();
  console.log("\n=== Section A ===");
  console.log("Name:", secA?.name);
  console.log("Default Fees:", secA?.defaultFees);

  await mongoose.disconnect();
}

check().catch(console.error);
