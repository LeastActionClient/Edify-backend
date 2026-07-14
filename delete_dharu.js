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
    const id = '6a4f5cae3fc11161212b35ad'; // dharu's id
    const reqUserId = '6a4e47fc7583696d5b9e0ccd'; // superadmin id
    
    console.log('Deleting dharu with ID:', id);
    await ActivityLog.deleteMany({ userId: id });
    await Student.updateMany({ addedById: id }, { $set: { addedById: null } });
    await Application.updateMany({ processedById: id }, { $set: { processedById: null } });
    await Payment.updateMany({ recordedById: id }, { $set: { recordedById: null } });
    
    const userToDelete = await User.findByIdAndDelete(id);
    
    await ActivityLog.create({
      userId: reqUserId,
      action: 'DELETED_ADMIN',
      details: `Admin ${userToDelete?.username || 'dharu'} deleted manually`
    });
    
    console.log('Successfully deleted admin "dharu"');
  } catch(e) {
    console.error('ERROR', e);
  }
  process.exit();
});
