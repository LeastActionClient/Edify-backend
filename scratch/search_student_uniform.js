import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-BE/src/controllers/studentController.js', 'utf8');
const lines = content.split('\n');
console.log('=== uniform in studentController.js ===');
lines.forEach((line, idx) => {
  if (line.includes('uniform') || line.includes('topPerMetre') || line.includes('uniformDetails')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
