import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/StudentEdit.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== uniformDetails/topLength in StudentEdit.jsx ===');
lines.forEach((line, idx) => {
  if (line.includes('uniform') || line.includes('topLength') || line.includes('bottomLength') || line.includes('topTotal')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
