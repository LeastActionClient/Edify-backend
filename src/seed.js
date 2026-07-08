import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from './models/index.js';

async function main() {
  const superAdminExists = await User.findOne({ role: 'SUPER_ADMIN' });

  if (!superAdminExists) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await User.create({
      username: 'superadmin',
      password: hashedPassword,
      role: 'SUPER_ADMIN',
      isActive: true
    });
    console.log('Super Admin created with username: superadmin and password: admin123');
  } else {
    console.log('Super Admin already exists.');
  }
}

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/school_project')
  .then(() => main())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
