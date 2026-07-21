import fs from 'fs';
import path from 'path';

const logPath = 'C:\\Users\\thivy\\.gemini\\antigravity\\brain\\05d19221-506a-49a6-a1c3-3f5b641f5772\\.system_generated\\logs\\transcript.jsonl';

try {
  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  console.log(`Total conversation steps loaded: ${lines.length}`);
  
  let stepNum = 1;
  lines.forEach((line) => {
    try {
      const obj = JSON.parse(line);
      if (obj.source === 'USER_EXPLICIT' || obj.type === 'USER_INPUT') {
        console.log(`\n[Step ${stepNum}] USER INPUT:`);
        console.log(obj.content || obj.text || JSON.stringify(obj));
        stepNum++;
      }
    } catch (e) {
      // ignore parse error for specific lines
    }
  });
} catch (err) {
  console.error('Error reading transcript log file:', err);
}
