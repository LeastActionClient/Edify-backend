import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Concessions.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== resetModalFields references ===');
lines.forEach((line, idx) => {
  if (line.includes('resetModalFields') || line.includes('setSelectedStudentId')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
