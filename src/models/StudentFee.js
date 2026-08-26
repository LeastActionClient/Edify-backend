import mongoose from 'mongoose';

const studentFeeSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  feeCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeCategory' }, // Optional for Other Fees
  includedChargeId: { type: mongoose.Schema.Types.ObjectId, ref: 'IncludedCharge' }, // Used for Other Fees
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

studentFeeSchema.index({ studentId: 1, feeCategoryId: 1, className: 1, academicYear: 1 }, { unique: false }); // Removed unique constraint to allow multiple of same other fee? Wait, maybe just keep it simple.
studentFeeSchema.index({ studentId: 1, academicYear: 1 });
studentFeeSchema.index({ studentId: 1, className: 1 });
studentFeeSchema.index({ feeCategoryId: 1, className: 1 });
studentFeeSchema.index({ includedChargeId: 1 });

export default mongoose.model('StudentFee', studentFeeSchema);

