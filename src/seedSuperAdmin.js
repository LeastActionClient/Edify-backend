import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import { User } from './models/index.js';

dotenv.config();

async function seedSuperAdmin() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('[ERROR] MONGODB_URI is not set in environment variables.');
    process.exit(1);
  }

  // Support both SUPER_ADMIN_EMAIL / SUPER_ADMIN_USERNAME and existing SUPERADMIN_USERNAME
  const superAdminIdentifier = (
    process.env.SUPER_ADMIN_EMAIL ||
    process.env.SUPER_ADMIN_USERNAME ||
    process.env.SUPERADMIN_USERNAME
  )?.trim();

  const superAdminPassword = (
    process.env.SUPER_ADMIN_PASSWORD ||
    process.env.SUPERADMIN_PASSWORD
  );

  if (!superAdminIdentifier) {
    console.error('[ERROR] Super Admin identifier missing.');
    console.error('Please define SUPER_ADMIN_EMAIL (or SUPER_ADMIN_USERNAME) in your .env file or environment.');
    process.exit(1);
  }

  if (!superAdminPassword) {
    console.error('[ERROR] Super Admin password missing.');
    console.error('Please define SUPER_ADMIN_PASSWORD in your .env file or environment.');
    process.exit(1);
  }

  try {
    console.log('[INFO] Connecting to database...');
    await connectDB();

    // Check if account already exists with this identifier (case-insensitive)
    const existingUser = await User.findOne({
      username: { $regex: new RegExp(`^${superAdminIdentifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });

    if (existingUser) {
      console.log(`[INFO] Super Admin account "${existingUser.username}" already exists.`);
      console.log(`       Role: ${existingUser.role} | Status: ${existingUser.isActive ? 'Active' : 'Inactive'}`);
      console.log('[INFO] Existing account was preserved without resetting or overwriting credentials.');
      return;
    }

    // Securely hash password using bcrypt (matching existing auth system: 10 salt rounds)
    const hashedPassword = await bcrypt.hash(superAdminPassword, 10);

    // Create the Super Admin record with required schema fields
    const newAdmin = await User.create({
      username: superAdminIdentifier,
      password: hashedPassword,
      role: 'SUPER_ADMIN',
      isActive: true,
      lastActivity: new Date()
    });

    console.log(`[SUCCESS] Super Admin account "${newAdmin.username}" created successfully.`);
    console.log(`          Role: ${newAdmin.role} | Status: Active`);
    console.log('[SUCCESS] You can now log in using this account on the login page.');
  } catch (error) {
    console.error('[ERROR] Failed to seed Super Admin:', error.message || error);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
      console.log('[INFO] Database connection closed cleanly.');
    } catch (disconnectErr) {
      console.error('[WARN] Error closing database connection:', disconnectErr.message);
    }
  }
}

seedSuperAdmin();
