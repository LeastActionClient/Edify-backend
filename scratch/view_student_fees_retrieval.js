import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-BE/src/controllers/studentController.js', 'utf8');
const lines = content.split('\n');
console.log('=== getStudentById retrieval lines ===');
let inMethod = false;
lines.forEach((line, idx) => {
  if (line.includes('export const getStudentById =')) {
    inMethod = true;
  }
  if (inMethod) {
    console.log(`${idx + 1}: ${line}`);
    if (line.includes('res.json(') || line.includes('res.status(')) {
      if (idx > 220) inMethod = false; // Stop after method end
    }
  }
});
