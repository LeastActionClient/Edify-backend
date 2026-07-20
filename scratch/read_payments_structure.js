import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Payments.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== search for checkboxes or fee mappings ===');
lines.forEach((line, idx) => {
  if (line.includes('checkbox') || line.includes('checked') || line.includes('map') || line.includes('studentFees') || line.includes('api') || line.includes('axios')) {
    if (line.toLowerCase().includes('fee') || line.toLowerCase().includes('pay') || line.toLowerCase().includes('amount')) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  }
});
