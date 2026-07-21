import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/StudentEdit.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== Admission Number render in StudentEdit.jsx ===');
lines.forEach((line, idx) => {
  if (line.includes('Admission Number') && idx < 600) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
