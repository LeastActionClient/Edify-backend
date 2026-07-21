import mongoose from 'mongoose';

const academicYearSchema = new mongoose.Schema({
  year: { type: String, required: true, unique: true, trim: true },
  status: { type: String, required: true, enum: ['Active', 'Completed'], default: 'Active' }
}, { timestamps: true });

academicYearSchema.index({ status: 1, year: -1 });

export default mongoose.model('AcademicYear', academicYearSchema);
