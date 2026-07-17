import mongoose from 'mongoose';

const stockHistorySchema = new mongoose.Schema({
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeCategory', required: true },
  categoryName: { type: String },
  previousStock: { type: Number, required: true },
  updatedStock: { type: Number, required: true },
  difference: { type: Number, required: true },
  action: { type: String, default: 'MANUAL_CORRECTION' },
  referenceType: { type: String },
  referenceId: { type: mongoose.Schema.Types.ObjectId },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

export default mongoose.model('StockHistory', stockHistorySchema);
