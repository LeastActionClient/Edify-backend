import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  notes: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0.01 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

expenseSchema.index({ date: -1, createdAt: -1 });
expenseSchema.index({ amount: 1 });

export default mongoose.model('Expense', expenseSchema);
