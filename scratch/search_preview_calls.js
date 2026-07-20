import fs from 'fs';

const filepath = 'c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Payments.jsx';
const content = fs.readFileSync(filepath, 'utf8');
const lines = content.split('\n');

console.log('=== Call sites for openInvoicePreview in Payments.jsx ===');
lines.forEach((line, idx) => {
  if (line.includes('openInvoicePreview')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
