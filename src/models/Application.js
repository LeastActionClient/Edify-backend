import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema({
  applicationId: { type: String, required: true, unique: true },
  adminNo: { type: String },
  studentName: { type: String, required: true },
  parentName: { type: String, required: true },
  fatherName: { type: String },
  motherName: { type: String },
  fatherPhone: { type: String },
  motherPhone: { type: String },
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

export default mongoose.model('Application', applicationSchema);
