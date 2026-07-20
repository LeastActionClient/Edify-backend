import fs from 'fs';
import path from 'path';

const searchPath = 'c:/kasthuri billing software/Kasthuri-Billing-BE/src';

function walk(dir, callback) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filepath = path.join(dir, file);
    const stats = fs.statSync(filepath);
    if (stats.isDirectory()) {
      walk(filepath, callback);
    } else if (stats.isFile() && file.endsWith('.js')) {
      callback(filepath);
    }
  });
}

walk(searchPath, (filepath) => {
  const content = fs.readFileSync(filepath, 'utf8');
  if (content.includes('getInvoicePaymentData')) {
    console.log(`Found call in: ${filepath}`);
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (line.includes('getInvoicePaymentData')) {
        console.log(`  ${idx + 1}: ${line.trim()}`);
      }
    });
  }
});
