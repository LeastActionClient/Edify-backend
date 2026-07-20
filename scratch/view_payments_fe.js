import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Payments.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== payments rendering in Payments.jsx ===');
lines.forEach((line, idx) => {
  if (line.includes('handleSubmit') || line.includes('selectedFees') || line.includes('setSelectedFees') || line.includes('totalAmount') || line.includes('amount') || line.includes('paying') || line.includes('paidAmount')) {
    if (idx > 200 && idx < 500) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  }
});
