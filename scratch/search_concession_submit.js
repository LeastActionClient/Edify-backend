import fs from 'fs';
const content = fs.readFileSync('c:/kasthuri billing software/Kasthuri-Billing-FE/src/pages/Concessions.jsx', 'utf8');
const lines = content.split('\n');
console.log('=== Concession submit handler in Concessions.jsx ===');
let inSubmit = false;
lines.forEach((line, idx) => {
  if (line.includes('handleSubmit') || line.includes('handleAssign') || line.includes('const assign') || line.includes('api.post(\'/concessions\'')) {
    inSubmit = true;
  }
  if (inSubmit) {
    console.log(`${idx + 1}: ${line}`);
    if (line.includes('toastSuccess') || line.includes('toastError') || line.includes('setIsModalOpen') || line.includes('setModalOpen')) {
      if (idx > 180) inSubmit = false;
    }
  }
});
