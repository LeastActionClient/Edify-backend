import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema({
  applicationId: { type: String, required: true, unique: true },
  adminNo: { type: String },
  studentName: { type: String, required: true },
  parentName: { type: String },
  fatherName: { type: String },
  motherName: { type: String },
  fatherPhone: { type: String },
  motherPhone: { type: String },
  guardianName: { type: String },
  guardianPhone: { type: String },
  address: { type: String },
  applyingClass: { type: String, required: true },
  previousSchool: { type: String },
  applicationDate: { type: Date, default: Date.now },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  feePaid: { type: Boolean, default: false },
  feeAmount: { type: Number, default: 0 },
  feePaidDate: { type: Date },
  siblings: { type: mongoose.Schema.Types.Mixed },
  processedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date }
}, { timestamps: true });

applicationSchema.index({ status: 1, applicationDate: -1 });
applicationSchema.index({ feePaid: 1, feePaidDate: -1 });
applicationSchema.index({ applyingClass: 1, status: 1 });

export default mongoose.model('Application', applicationSchema);
