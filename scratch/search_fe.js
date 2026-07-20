import fs from 'fs';
import path from 'path';

const searchPath = 'c:/kasthuri billing software/Kasthuri-Billing-FE/src';

function walk(dir, callback) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filepath = path.join(dir, file);
    const stats = fs.statSync(filepath);
    if (stats.isDirectory()) {
      walk(filepath, callback);
    } else if (stats.isFile() && (file.endsWith('.js') || file.endsWith('.jsx'))) {
      callback(filepath);
    }
  });
}

const keyword = 'Select Fees to Pay';
walk(searchPath, (filepath) => {
  const content = fs.readFileSync(filepath, 'utf8');
  if (content.includes(keyword) || content.includes('paymentModal') || content.includes('/payments')) {
    console.log(`Found in: ${filepath}`);
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (line.includes('api.get') || line.includes('fees') || line.includes('pending') || line.includes('remainingAmount')) {
        if (line.length < 150) {
          console.log(`  ${idx + 1}: ${line.trim()}`);
        }
      }
    });
  }
});
