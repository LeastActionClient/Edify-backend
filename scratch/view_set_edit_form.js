import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Admissions.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== setEditForm calls in Admissions.jsx ===');
lines.forEach((line, idx) => {
  if (line.includes('setEditForm')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
