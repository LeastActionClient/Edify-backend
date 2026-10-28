import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import { Payment, User } from './models/index.js';

dotenv.config();

async function seedCollection() {
  const amountArg = process.argv[2];
  const targetAmount = amountArg ? parseFloat(amountArg) : 50000;

  if (isNaN(targetAmount) || targetAmount <= 0) {
    console.error('[ERROR] Please provide a valid positive number for collection amount.');
    process.exit(1);
  }

  try {
    console.log('[INFO] Connecting to database...');
    await connectDB();

    const admin = await User.findOne({ role: 'SUPER_ADMIN' });
    const adminId = admin ? admin._id : null;

    // Check if an initial seed payment already exists
    let payment = await Payment.findOne({ remarks: 'Initial institutional fee collection' });

    if (payment) {
      payment.amount = targetAmount;
      payment.paymentDate = new Date();
      await payment.save();
      console.log(`[SUCCESS] Existing test collection updated to ₹${targetAmount.toLocaleString('en-IN')}`);
    } else {
      payment = await Payment.create({
        amount: targetAmount,
        paymentType: 'FEE',
        paymentMethod: 'Cash',
        paymentDate: new Date(),
        status: 'PAID',
        remarks: 'Initial institutional fee collection',
        recordedById: adminId
      });
      console.log(`[SUCCESS] Seeded collection payment of ₹${targetAmount.toLocaleString('en-IN')} (Payment ID: ${payment._id})`);
    }

    console.log('[INFO] Total Collections on Reports & Analytics and Accounts will now reflect this amount.');
  } catch (err) {
    console.error('[ERROR] Failed to seed collection:', err.message || err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('[INFO] Database connection closed cleanly.');
  }
}

seedCollection();
