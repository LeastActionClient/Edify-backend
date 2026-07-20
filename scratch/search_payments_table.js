import fs from 'fs';

const filepath = 'c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Payments.jsx';
const content = fs.readFileSync(filepath, 'utf8');
const lines = content.split('\n');

console.log('=== Payments page fee list rendering ===');
lines.forEach((line, idx) => {
  if (line.includes('studentFees') || line.includes('fees') || line.includes('remainingAmount') || line.includes('totalAmount')) {
    if (line.includes('<tr') || line.includes('<td') || line.includes('<TableCell') || line.includes('.map') || line.includes('{')) {
      if (idx > 500 && idx < 650) {
        console.log(`${idx + 1}: ${line.trim()}`);
      }
    }
  }
});
