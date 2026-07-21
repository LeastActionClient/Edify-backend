import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Admissions.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== Academic Year references in Admissions.jsx ===');
lines.forEach((line, idx) => {
  if (line.includes('academicYear') || line.toLowerCase().includes('academic year')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
