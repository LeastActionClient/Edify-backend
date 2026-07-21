import mongoose from 'mongoose';

const includedChargeSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String },
  amount: { type: Number, required: true },
  stockQuantity: { type: Number, default: 0, min: 0 },
  lowStockThreshold: { type: Number, default: 5, min: 0 },
  stockUnit: { type: String, default: 'pcs' },
  status: { type: Boolean, default: true },
  createdById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

includedChargeSchema.index({ status: 1, createdAt: -1 });
includedChargeSchema.index({ createdById: 1, createdAt: -1 });

export default mongoose.model('IncludedCharge', includedChargeSchema);
