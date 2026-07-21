import mongoose from 'mongoose';

const studentActivitySchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  activityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity', required: true }
}, { timestamps: true });

studentActivitySchema.index({ studentId: 1, activityId: 1 }, { unique: true });
studentActivitySchema.index({ studentId: 1 });

export default mongoose.model('StudentActivity', studentActivitySchema);
