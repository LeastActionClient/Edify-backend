import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Students.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== DollarSign references in Students.jsx ===');
lines.forEach((line, idx) => {
  if (line.toLowerCase().includes('dollarsign')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
