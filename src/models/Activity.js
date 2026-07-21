import mongoose from 'mongoose';

const activitySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String },
  amount: { type: Number, required: true },
  status: { type: Boolean, default: true },
  createdById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

activitySchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('Activity', activitySchema);
