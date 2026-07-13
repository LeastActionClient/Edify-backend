async function run() {
  try {
    const loginRes = await fetch('http://localhost:5000/api/auth/login', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password' })
    });
    const loginData = await loginRes.json();
    const token = loginData.token;
    
    console.log("Logged in. Testing export...");
    
    const exportRes = await fetch('http://localhost:5000/api/exports/students', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify({
        exportScope: 'CLASS',
        exportType: 'PDF',
        classFilter: 'UKG'
      })
    });
    
    if (!exportRes.ok) {
      console.log(exportRes.status, exportRes.statusText);
      const text = await exportRes.text();
      console.log(text);
    } else {
      console.log("Export successful");
    }
  } catch(e) {
    console.error(e);
  }
}
run();
