import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  _id: { type: String, default: 'global' },
  nextApplicationNo: { type: String, default: '' },
  applicationFeeAmount: { type: String, default: '' }
}, { timestamps: true });

export default mongoose.model('Settings', settingsSchema);
