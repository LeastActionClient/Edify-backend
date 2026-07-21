import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/StudentEdit.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== handleValidatedChange in StudentEdit.jsx ===');
let inMethod = false;
lines.forEach((line, idx) => {
  if (line.includes('const handleValidatedChange')) {
    inMethod = true;
  }
  if (inMethod) {
    console.log(`${idx + 1}: ${line}`);
    if (line.includes('};') || line.includes('}')) {
      // Let's print up to 30 lines
      if (idx > 130) inMethod = false;
    }
  }
});
