import mongoose from 'mongoose';

const includedChargeStockTransactionSchema = new mongoose.Schema({
  includedChargeId: { type: mongoose.Schema.Types.ObjectId, ref: 'IncludedCharge', required: true },
  type: { type: String, enum: ['IN', 'OUT', 'ADJUSTMENT', 'RETURN'], required: true },
  quantity: { type: Number, required: true, min: 1 },
  previousStock: { type: Number, required: true, min: 0 },
  newStock: { type: Number, required: true, min: 0 },
  reason: { type: String },
  referenceType: { type: String },
  referenceId: { type: mongoose.Schema.Types.ObjectId },
  performedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

includedChargeStockTransactionSchema.index({ includedChargeId: 1, createdAt: -1 });

export default mongoose.model('IncludedChargeStockTransaction', includedChargeStockTransactionSchema);
