import fs from 'fs';

const filepath = 'c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/StudentEdit.jsx';
const content = fs.readFileSync(filepath, 'utf8');
const lines = content.split('\n');

console.log('=== Fee rendering sections in StudentEdit.jsx ===');
lines.forEach((line, idx) => {
  if (line.includes('remainingAmount') || line.includes('fees') || line.includes('StudentFee') || line.includes('originalAmount')) {
    if (line.includes('<td') || line.includes('<TableCell') || line.includes('.map') || line.includes('text-')) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  }
});
