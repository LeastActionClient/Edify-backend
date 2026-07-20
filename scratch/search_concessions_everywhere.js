import fs from 'fs';

const pages = [
  'c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/PendingFees.jsx',
  'c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/OldStudents.jsx',
  'c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Payments.jsx'
];

pages.forEach(filepath => {
  if (fs.existsSync(filepath)) {
    const content = fs.readFileSync(filepath, 'utf8');
    const lines = content.split('\n');
    console.log(`=== Matches in ${filepath} ===`);
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes('concession') || line.toLowerCase().includes('less') || line.toLowerCase().includes('discount')) {
        console.log(`${idx + 1}: ${line.trim()}`);
      }
    });
  }
});
