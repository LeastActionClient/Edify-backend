import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/StudentEdit.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== StudentEdit.jsx fetchData lines ===');
let inMethod = false;
lines.forEach((line, idx) => {
  if (line.includes('const fetchData =')) {
    inMethod = true;
  }
  if (inMethod) {
    console.log(`${idx + 1}: ${line}`);
    if (line.includes('setFormData(') || line.includes('setBaseFeeAmount(') || idx > 250) {
      if (idx > 220) inMethod = false;
    }
  }
});
