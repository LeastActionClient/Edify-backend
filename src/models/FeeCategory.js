import mongoose from 'mongoose';

const feeCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  isEnabled: { type: Boolean, default: true }
}, { timestamps: true });

export default mongoose.model('FeeCategory', feeCategorySchema);
