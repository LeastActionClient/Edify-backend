import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/StudentEdit.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== academicYear rendering in StudentEdit.jsx ===');
lines.forEach((line, idx) => {
  if (line.includes('academicYear') && idx > 300) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
