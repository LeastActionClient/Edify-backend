import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { PassThrough } from 'stream';
import { generateInvoicePDF } from './src/controllers/paymentController.js';

dotenv.config();

const PAYMENT_ID = '6a7431e7ab937c5cd08f5069';

try {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.');

  const req = { params: { id: PAYMENT_ID }, query: {} };

  const res = new PassThrough();
  const headerMap = new Map();
  res.setHeader = (k, v) => headerMap.set(k, v);
  res.status = (code) => { res._status = code; return res; };
  res.json = (data) => { console.log('JSON response', res._status, JSON.stringify(data).slice(0, 300)); };

  let bytes = 0;
  res.on('data', (chunk) => { bytes += chunk.length; });
  res.on('end', () => console.log('PDF bytes:', bytes));

  await generateInvoicePDF(req, res);
  console.log('Completed without error.');
} catch (err) {
  console.error('EXACT STACK:');
  console.error(err);
} finally {
  await mongoose.disconnect();
  process.exit(0);
}
