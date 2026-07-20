import fs from 'fs';
import path from 'path';

function walkDir(dir) {
  let files = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      files = files.concat(walkDir(filePath));
    } else {
      if (file.toLowerCase().includes('invoice') || file.toLowerCase().includes('receipt')) {
        files.push(filePath);
      }
    }
  });
  return files;
}

const frontendDir = 'c:/kasthuri billing software/Kasthuri-Billing-FE/src';
console.log('=== Invoice/Receipt files on Frontend ===');
console.log(walkDir(frontendDir));
