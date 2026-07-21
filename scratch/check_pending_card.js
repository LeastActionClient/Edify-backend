import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Reports.jsx', 'utf8');
console.log('=== Pending block size and styling in Reports.jsx ===');
console.log(content.substring(content.indexOf('<Card>\n          <CardHeader>\n            <CardTitle className="flex items-center text-gray-700 ">')));
