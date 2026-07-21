import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Admissions.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== handleEditSave in Admissions.jsx ===');
let inMethod = false;
lines.forEach((line, idx) => {
  if (line.includes('const handleEditSave =')) {
    inMethod = true;
  }
  if (inMethod) {
    console.log(`${idx + 1}: ${line}`);
    if (line.includes('toastSuccess(') || line.includes('toastError(') || idx > 490) {
      if (idx > 440) inMethod = false;
    }
  }
});
