import fs from 'fs';
import path from 'path';

function searchDir(dir, query) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
        searchDir(fullPath, query);
      }
    } else if (file.endsWith('.jsx') || file.endsWith('.js') || file.endsWith('.html') || file.endsWith('.css')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes(query) || content.toLowerCase().includes('dollarsign')) {
        console.log(`Found in: ${fullPath}`);
      }
    }
  }
}

console.log('=== Searching for dollar references in Kasthuri-Billing-FE ===');
searchDir('c:/kasthuri billing software/Kasthuri-Billing-FE/src', 'DollarSign');
searchDir('c:/kasthuri billing software/Kasthuri-Billing-FE/src', '$');
