import mongoose from 'mongoose';

const studentIncludedChargeSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  includedChargeId: { type: mongoose.Schema.Types.ObjectId, ref: 'IncludedCharge', required: true }
}, { timestamps: true });

studentIncludedChargeSchema.index({ studentId: 1, includedChargeId: 1 }, { unique: true });

export default mongoose.model('StudentIncludedCharge', studentIncludedChargeSchema);
