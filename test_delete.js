import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/models/User.js';
import ActivityLog from './src/models/ActivityLog.js';
import Student from './src/models/Student.js';
import Application from './src/models/Application.js';
import Payment from './src/models/Payment.js';

dotenv.config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  try {
    const id = '6a4e4a357583696d5b9e0d42'; // The admin user from earlier fetch
    const reqUserId = '6a4e47fc7583696d5b9e0ccd'; // superadmin id
    
    console.log('Deleting', id);
    await ActivityLog.deleteMany({ userId: id });
    console.log('1');
    await Student.updateMany({ addedById: id }, { $set: { addedById: null } });
    console.log('2');
    await Application.updateMany({ processedById: id }, { $set: { processedById: null } });
    console.log('3');
    await Payment.updateMany({ recordedById: id }, { $set: { recordedById: null } });
    console.log('4');
    const userToDelete = await User.findByIdAndDelete(id);
    console.log('5');
    await ActivityLog.create({
      userId: reqUserId,
      action: 'DELETED_ADMIN',
      details: `Admin ${userToDelete?.username} deleted`
    });
    console.log('Deleted successfully');
  } catch(e) {
    console.error('ERROR', e);
  }
  process.exit();
});
