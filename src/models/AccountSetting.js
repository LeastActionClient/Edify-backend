import mongoose from 'mongoose';

const accountSettingSchema = new mongoose.Schema({
  key: { type: String, default: 'primary', unique: true },
  totalAmount: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

export default mongoose.model('AccountSetting', accountSettingSchema);
