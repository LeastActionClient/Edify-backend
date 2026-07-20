import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-BE/src/controllers/concessionController.js', 'utf8');
const lines = content.split('\n');
console.log('=== defaultFees in concessionController.js ===');
lines.forEach((line, idx) => {
  if (line.includes('defaultFees') || line.includes('Class.findOne')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
