import fs from 'fs';

function printLines(filePath, name) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  console.log(`=== Pincode lines in ${name} ===`);
  lines.forEach((line, idx) => {
    if (line.toLowerCase().includes('pincode')) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  });
}

printLines('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Admissions.jsx', 'Admissions.jsx');
printLines('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/StudentEdit.jsx', 'StudentEdit.jsx');
