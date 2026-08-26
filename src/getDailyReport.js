import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import { Payment, Application } from './models/index.js';
async function getDailyReport() {
  await mongoose.connect(process.env.MONGODB_URI);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);
  const payments = await Payment.find({ paymentDate: { $gte: today, $lte: endOfDay }, paymentType: { $ne: 'APPLICATION' } }).lean();
  const appFees = await Application.find({ feePaid: true, feePaidDate: { $gte: today, $lte: endOfDay } }).lean();
  const totalPayments = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const totalAppFees = appFees.reduce((sum, a) => sum + (a.feeAmount || 0), 0);
  const totalCollection = totalPayments + totalAppFees;
  console.log('Daily Report for', today.toLocaleDateString());
  console.log('Total Collection: Rs.', totalCollection);
  console.log('Total Payments (Regular Fees): Rs.', totalPayments, 'from', payments.length, 'transactions');
  console.log('Total Application Fees: Rs.', totalAppFees, 'from', appFees.length, 'applications');
  process.exit(0);
}
getDailyReport().catch(console.error);
