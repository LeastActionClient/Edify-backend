import mongoose from 'mongoose';

const sectionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  defaultFees: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

sectionSchema.index({ name: 1, classId: 1 }, { unique: true });
sectionSchema.index({ classId: 1 });

export default mongoose.model('Section', sectionSchema);
