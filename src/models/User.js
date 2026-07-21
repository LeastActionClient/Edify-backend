import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['SUPER_ADMIN', 'ADMIN'], default: 'ADMIN' },
  isActive: { type: Boolean, default: true },
  lastActivity: { type: Date, default: Date.now }
}, { timestamps: true });

userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ lastActivity: -1 });

export default mongoose.model('User', userSchema);
