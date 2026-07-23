import mongoose from 'mongoose';

const studentFeeConcessionSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  studentFeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentFee', required: true },
  academicYearId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear' },
  academicYear: { type: String, required: true },
  className: { type: String, required: true },
  section: { type: String },
  feeCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeCategory', required: true },
  originalAmount: { type: Number, required: true },
  lessAmount: { type: Number, required: true },
  reason: { type: String, required: true },
  remarks: { type: String, default: '' },
  status: { type: String, enum: ['Active', 'Inactive', 'Cancelled'], default: 'Active' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletedAt: { type: Date }
}, { timestamps: true });

// Index for performance and fast lookups
studentFeeConcessionSchema.index({ academicYearId: 1, studentId: 1, feeCategoryId: 1, status: 1 });
studentFeeConcessionSchema.index({ studentId: 1, feeCategoryId: 1, status: 1 });
studentFeeConcessionSchema.index({ studentFeeId: 1, status: 1 });
studentFeeConcessionSchema.index({ academicYear: 1, className: 1, section: 1 });

export default mongoose.model('StudentFeeConcession', studentFeeConcessionSchema);
