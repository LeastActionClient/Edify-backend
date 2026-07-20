import fs from 'fs';
import path from 'path';

const files = [
  'c:/kasthuri billing software/Kasthuri-Billing-BE/src/controllers/studentController.js',
  'c:/kasthuri billing software/Kasthuri-Billing-BE/src/controllers/paymentController.js'
];

function searchInFile(filepath, keyword) {
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split('\n');
  console.log(`=== Matches in ${path.basename(filepath)} for "${keyword}" ===`);
  lines.forEach((line, idx) => {
    if (line.toLowerCase().includes(keyword.toLowerCase())) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  });
}

searchInFile(files[0], 'pending');
searchInFile(files[0], 'fee');
searchInFile(files[1], 'find({');
searchInFile(files[1], 'pending');
