import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Concessions.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== Concessions.jsx handleAssignConcession lines ===');
lines.forEach((line, idx) => {
  if (idx >= 140 && idx <= 230) {
    console.log(`${idx + 1}: ${line}`);
  }
});
