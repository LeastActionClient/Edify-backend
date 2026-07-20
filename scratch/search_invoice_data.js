import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-BE/src/controllers/paymentController.js', 'utf8');
const lines = content.split('\n');
console.log('=== getInvoicePaymentData definition ===');
lines.forEach((line, idx) => {
  if (line.includes('getInvoicePaymentData') || line.includes('export const getInvoicePaymentData')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
