import jwt from 'jsonwebtoken';
import app, { dbReady } from '../app.js';
import { AccountSetting, Expense, User } from '../models/index.js';

async function runTests() {
  console.log('--- Starting Accounts API Unit & Integration Tests ---');
  await dbReady;

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api/accounts`;
  console.log(`Test server running at http://localhost:${port}`);

  try {
    const jwtSecret = process.env.JWT_SECRET || 'supersecretkey123';

    // 1. Test unauthenticated request
    console.log('\n1. Testing unauthenticated request to /api/accounts...');
    const res1 = await fetch(baseUrl);
    console.log(`Status: ${res1.status} (Expected: 401)`);
    if (res1.status !== 401) throw new Error('Unauthenticated test failed');

    // 2. Test regular ADMIN request (forbidden)
    console.log('\n2. Testing regular ADMIN role request to /api/accounts...');
    let adminUser = await User.findOne({ role: 'ADMIN' });
    if (!adminUser) {
      adminUser = await User.findOne({});
    }
    const adminToken = jwt.sign({ id: adminUser ? adminUser._id : '507f1f77bcf86cd799439011', role: 'ADMIN' }, jwtSecret);
    const res2 = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log(`Status: ${res2.status} (Expected: 403)`);
    if (res2.status !== 403) throw new Error('Admin forbidden test failed');

    // 3. Test SUPER_ADMIN access
    console.log('\n3. Testing SUPER_ADMIN role request to /api/accounts...');
    let superAdmin = await User.findOne({ role: 'SUPER_ADMIN' });
    if (!superAdmin) {
      console.log('No superadmin found in DB, using existing user id with SUPER_ADMIN role');
      superAdmin = adminUser;
    }
    const superAdminToken = jwt.sign({ id: superAdmin._id, role: 'SUPER_ADMIN' }, jwtSecret);
    const res3 = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    const body3 = await res3.json();
    console.log(`Status: ${res3.status} (Expected: 200)`);
    console.log('Accounts Summary:', {
      totalAmount: body3.totalAmount,
      totalExpenses: body3.totalExpenses,
      balance: body3.balance,
      expensesCount: body3.expenses?.length
    });
    if (res3.status !== 200) throw new Error('Superadmin GET failed');

    // 4. Test validation on Total Amount
    console.log('\n4. Testing Total Amount validation (negative value)...');
    const res4 = await fetch(`${baseUrl}/total-amount`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`
      },
      body: JSON.stringify({ totalAmount: -500 })
    });
    const body4 = await res4.json();
    console.log(`Status: ${res4.status} (Expected: 400) Error: ${body4.error}`);
    if (res4.status !== 400) throw new Error('Negative totalAmount should be rejected');

    // 5. Test updating Total Amount
    console.log('\n5. Testing updating Total Amount to 50000...');
    const res5 = await fetch(`${baseUrl}/total-amount`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`
      },
      body: JSON.stringify({ totalAmount: 50000 })
    });
    const body5 = await res5.json();
    console.log(`Status: ${res5.status} Body:`, body5);
    if (res5.status !== 200 || body5.totalAmount !== 50000) throw new Error('Update total amount failed');

    // 6. Test Expense validation (invalid amount)
    console.log('\n6. Testing Expense validation with amount 0...');
    const res6 = await fetch(`${baseUrl}/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`
      },
      body: JSON.stringify({ date: '2026-10-27', notes: 'Zero expense test', amount: 0 })
    });
    const body6 = await res6.json();
    console.log(`Status: ${res6.status} (Expected: 400) Error: ${body6.error}`);
    if (res6.status !== 400) throw new Error('Zero expense should be rejected');

    // 7. Test adding test expenses
    console.log('\n7. Testing adding Expense 1 (₹5000) and Expense 2 (₹3000)...');
    const res7a = await fetch(`${baseUrl}/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`
      },
      body: JSON.stringify({ date: '2026-10-20', notes: 'Test Expense 1 - Supplies', amount: 5000 })
    });
    const body7a = await res7a.json();
    console.log(`Added Expense 1: ${res7a.status}, ID: ${body7a.expense?._id}`);
    const id1 = body7a.expense?._id;

    const res7b = await fetch(`${baseUrl}/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`
      },
      body: JSON.stringify({ date: '2026-10-25', notes: 'Test Expense 2 - Maintenance', amount: 3000 })
    });
    const body7b = await res7b.json();
    console.log(`Added Expense 2: ${res7b.status}, ID: ${body7b.expense?._id}`);
    const id2 = body7b.expense?._id;

    // 8. Check balance calculation: Total: 50,000, Expenses: at least 8,000
    console.log('\n8. Checking balance calculations...');
    const res8 = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    const body8 = await res8.json();
    console.log(`Total Amount: ${body8.totalAmount}`);
    console.log(`Total Expenses: ${body8.totalExpenses}`);
    console.log(`Balance: ${body8.balance}`);
    const calculatedBalance = Math.round((body8.totalAmount - body8.totalExpenses) * 100) / 100;
    if (body8.balance !== calculatedBalance) {
      throw new Error(`Balance calculation mismatch: ${body8.balance} vs ${calculatedBalance}`);
    }

    // 9. Test filters (date filter)
    console.log('\n9. Testing date filter (2026-10-24 to 2026-10-26)...');
    const res9 = await fetch(`${baseUrl}?startDate=2026-10-24&endDate=2026-10-26`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    const body9 = await res9.json();
    console.log(`Filtered count: ${body9.expenses?.length}, Filtered Total: ${body9.filteredTotal}`);
    console.log(`Overall Total Expenses remained: ${body9.totalExpenses}`);
    if (body9.totalExpenses !== body8.totalExpenses) {
      throw new Error('Filtered request modified overall summary');
    }

    // 10. Test amount range filter
    console.log('\n10. Testing amount range filter (min 4000, max 6000)...');
    const res10 = await fetch(`${baseUrl}?minAmount=4000&maxAmount=6000`, {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    const body10 = await res10.json();
    console.log(`Filtered count for 4000-6000: ${body10.expenses?.length}`);
    if (!body10.expenses?.some(e => e._id === id1)) {
      throw new Error('Expense 1 should match min 4000 max 6000 filter');
    }

    // 11. Clean up test expenses
    console.log('\n11. Cleaning up test expenses...');
    if (id1) {
      const del1 = await fetch(`${baseUrl}/expenses/${id1}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${superAdminToken}` }
      });
      console.log(`Deleted Expense 1: ${del1.status}`);
    }
    if (id2) {
      const del2 = await fetch(`${baseUrl}/expenses/${id2}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${superAdminToken}` }
      });
      console.log(`Deleted Expense 2: ${del2.status}`);
    }
    console.log('Cleanup completed successfully.');

    console.log('\n>>> ALL BACKEND TESTS PASSED SUCCESSFULLY! <<<');
  } finally {
    server.close();
  }

  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
