import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/PrintExport.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== Pincode references in PrintExport.jsx ===');
lines.forEach((line, idx) => {
  if (line.toLowerCase().includes('pincode')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
