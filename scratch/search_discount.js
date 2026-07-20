import fs from 'fs';

const filepath = 'c:/kasthuri billing software/Kasthuri-Billing-BE/src/controllers/paymentController.js';
const content = fs.readFileSync(filepath, 'utf8');
const lines = content.split('\n');

console.log('=== Matches for discountAmount in paymentController.js ===');
lines.forEach((line, idx) => {
  if (line.includes('discountAmount') || line.includes('totals') || line.includes('pdf')) {
    if (line.length < 150) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  }
});
