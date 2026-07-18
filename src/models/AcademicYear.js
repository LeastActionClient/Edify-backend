import mongoose from 'mongoose';

const academicYearSchema = new mongoose.Schema({
  year: { type: String, required: true, unique: true, trim: true },
  status: { type: String, required: true, enum: ['Active', 'Completed'], default: 'Active' }
}, { timestamps: true });

export default mongoose.model('AcademicYear', academicYearSchema);
