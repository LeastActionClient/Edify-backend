import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema({
  applicationId: { type: String, required: true, unique: true },
  adminNo: { type: String },
  studentName: { type: String, required: true },
  fatherName: { type: String, required: true },
  motherName: { type: String, required: true },
  fatherPhone: { type: String, required: true },
  motherPhone: { type: String, required: true },
  address: { type: String, required: true },
  applyingClass: { type: String, required: true },
  previousSchool: { type: String },
  applicationDate: { type: Date, default: Date.now },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  feePaid: { type: Boolean, default: false },
  siblings: { type: mongoose.Schema.Types.Mixed },
  processedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' }
}, { timestamps: true });

export default mongoose.model('Application', applicationSchema);
