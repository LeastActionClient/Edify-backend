import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { StudentFee } from './src/models/index.js';

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("=== Repairing Thivya's Database Records ===");

  // 1. Repair Class 5 Term 1 remaining amount (1000 total - 500 concession - 500 paid = 0 remaining)
  const class5Term1 = await StudentFee.findById('6a61e09517032ee59a47f0d8');
  if (class5Term1) {
    class5Term1.remainingAmount = 0;
    await class5Term1.save();
    console.log("Repaired Class 5 Term 1 remaining amount to 0.");
  }

  // 2. Repair Class 6 Term 1 total and remaining amount (should be 2000 total, 1000 concession, 0 paid = 1000 remaining)
  const class6Term1 = await StudentFee.findById('6a61e19e17032ee59a47f203');
  if (class6Term1) {
    class6Term1.totalAmount = 2000;
    class6Term1.remainingAmount = 1000;
    await class6Term1.save();
    console.log("Repaired Class 6 Term 1 to Total: 2000, Remaining: 1000.");
  }

  // 3. Repair Class 6 Term 2 total and remaining amount (should be 2000 total, 0 concession, 0 paid = 2000 remaining)
  const class6Term2 = await StudentFee.findById('6a61e19e17032ee59a47f208');
  if (class6Term2) {
    class6Term2.totalAmount = 2000;
    class6Term2.remainingAmount = 2000;
    await class6Term2.save();
    console.log("Repaired Class 6 Term 2 to Total: 2000, Remaining: 2000.");
  }

  await mongoose.disconnect();
  console.log("=== Repair Complete ===");
}

run().catch(console.error);
