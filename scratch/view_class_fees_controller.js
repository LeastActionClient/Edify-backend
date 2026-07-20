import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-BE/src/controllers/feeController.js', 'utf8');
const lines = content.split('\n');
console.log('=== defaultFees in feeController.js ===');
lines.forEach((line, idx) => {
  if (line.includes('defaultFees') || line.includes('class') || line.includes('Class.')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
