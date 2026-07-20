import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-BE/src/controllers/concessionController.js', 'utf8');
console.log('mongoose referenced:', content.includes('mongoose.'));
