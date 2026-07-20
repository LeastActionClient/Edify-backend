import fs from 'fs';

const filepath = 'c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Students.jsx';
const content = fs.readFileSync(filepath, 'utf8');
const lines = content.split('\n');

console.log('=== Student Fee history / table blocks in Students.jsx ===');
lines.forEach((line, idx) => {
  if (line.includes('studentFees') || line.includes('fees') || line.includes('Table') || line.includes('remainingAmount')) {
    if (line.includes('<td') || line.includes('<TableCell') || line.includes('.map')) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  }
});
