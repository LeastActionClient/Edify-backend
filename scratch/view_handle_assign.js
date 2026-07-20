import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Concessions.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== handleAssignConcession in Concessions.jsx ===');
let inMethod = false;
lines.forEach((line, idx) => {
  if (line.includes('const handleAssignConcession')) {
    inMethod = true;
  }
  if (inMethod) {
    console.log(`${idx + 1}: ${line}`);
    if (line.includes('toastSuccess') || line.includes('toastError') || line.includes('setIsAssignModalOpen')) {
      // Let's print up to 50 lines or until closing brace of block
    }
  }
});
