import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/PendingFees.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== PendingFees.jsx inspection ===');
lines.forEach((line, idx) => {
  if (line.includes('remainingAmount') || line.includes('lessAmount') || line.includes('concessionStatus') || line.includes('net') || line.includes('totalAmount')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
