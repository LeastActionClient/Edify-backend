import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-BE/src/controllers/paymentController.js', 'utf8');
const lines = content.split('\n');
console.log('=== summary drawing in paymentController.js ===');
lines.forEach((line, idx) => {
  if (line.includes('summaryX') || line.includes('GRAND TOTAL') || line.includes('Balance Amount') || line.includes('Paid Amount')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
