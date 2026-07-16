import mongoose from 'mongoose';

const admissionSequenceSchema = new mongoose.Schema({
  _id: { type: String, default: 'student-admission-number' },
  prefix: { type: String, default: 'ADM' },
  padding: { type: Number, default: 4, min: 1 },
  value: { type: Number, default: 0, min: 0 },
  sourceAdmissionNumber: { type: String, default: '' }
}, { timestamps: true, versionKey: false });

export default mongoose.model('AdmissionSequence', admissionSequenceSchema);
