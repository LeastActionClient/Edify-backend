import fs from 'fs';
import path from 'path';

const searchDir = (dir) => {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      searchDir(fullPath);
    } else if (file.endsWith('.js')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('defaultFees') || content.includes('Class.find') || content.includes('Class.findOne')) {
        console.log(`Match in ${fullPath}`);
      }
    }
  });
};

searchDir('c:/kasthuri billing software/Kasthuri-Billing-BE/src');
