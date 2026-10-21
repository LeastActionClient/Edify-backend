import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { User } from './models/index.js';

dotenv.config();

async function seedUser({ username, password, role }) {
  const hashedPassword = await bcrypt.hash(password, 10);
  const existingUser = await User.findOne({ username });

  await User.findOneAndUpdate(
    { username },
    {
      $set: {
        password: hashedPassword,
        role,
        isActive: true
      },
      $setOnInsert: {
        username
      }
    },
    {
      upsert: true,
      new: true,
      runValidators: true
    }
  );

  const action = existingUser ? 'updated' : 'seeded';
  console.log(`${role} credential ${action} for username: ${username}`);
}

async function main() {
  const superAdminUsername = process.env.SUPERADMIN_USERNAME || 'lotusschool';
  const superAdminPassword = process.env.SUPERADMIN_PASSWORD || 'Lnps@2015';
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  await seedUser({
    username: superAdminUsername,
    password: superAdminPassword,
    role: 'SUPER_ADMIN'
  });

  await seedUser({
    username: adminUsername,
    password: adminPassword,
    role: 'ADMIN'
  });
}

async function bootstrap() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/school_project');
    await main();
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

bootstrap();
