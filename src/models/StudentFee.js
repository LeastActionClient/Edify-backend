import mongoose from 'mongoose';

const studentFeeSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  feeCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeCategory', required: true },
  totalAmount: { type: Number, required: true },
  paidAmount: { type: Number, default: 0 },
  remainingAmount: { type: Number, required: true },
  academicYear: { type: String },
  className: { type: String },
  uniformDetails: {
    topLength: { type: Number, default: 0 },
    bottomLength: { type: Number, default: 0 }
  },
  isStockDeducted: { type: Boolean, default: false }
}, { timestamps: true });

studentFeeSchema.index({ studentId: 1, feeCategoryId: 1, className: 1 }, { unique: true });
studentFeeSchema.index({ studentId: 1, academicYear: 1 });
studentFeeSchema.index({ studentId: 1, className: 1 });
studentFeeSchema.index({ feeCategoryId: 1, className: 1 });

export default mongoose.model('StudentFee', studentFeeSchema);

