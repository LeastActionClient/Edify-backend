import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Reports.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== Reports.jsx layout inspection ===');
lines.forEach((line, idx) => {
  if (line.includes('Pending Fees') || line.includes('Total Outstanding') || line.includes('grid-cols') || line.includes('flex flex-col')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
