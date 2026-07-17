import mongoose from 'mongoose';

const feeCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  isEnabled: { type: Boolean, default: true },
  mandatory: { type: Boolean, default: false },
  isStockItem: { type: Boolean, default: false },
  currentStock: { type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.model('FeeCategory', feeCategorySchema);
