import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  _id: { type: String, default: 'global' },
  nextApplicationNo: { type: String },
  nextAdmissionNo: { type: String }
}, { timestamps: true });

export default mongoose.model('Settings', settingsSchema);
