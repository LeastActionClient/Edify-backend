import fs from 'fs';

const files = [
  'c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Students.jsx',
  'c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/StudentEdit.jsx'
];

files.forEach(filepath => {
  if (fs.existsSync(filepath)) {
    const content = fs.readFileSync(filepath, 'utf8');
    const lines = content.split('\n');
    console.log(`=== Matches in ${filepath} ===`);
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes('concession') || line.toLowerCase().includes('lessamount') || line.toLowerCase().includes('remaining')) {
        console.log(`${idx + 1}: ${line.trim()}`);
      }
    });
  } else {
    console.log(`${filepath} does not exist`);
  }
});
