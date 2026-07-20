import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-BE/src/controllers/paymentController.js', 'utf8');
const lines = content.split('\n');
console.log('=== createPayment definition ===');
lines.forEach((line, idx) => {
  if (line.includes('createPayment') || line.includes('export const createPayment')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
