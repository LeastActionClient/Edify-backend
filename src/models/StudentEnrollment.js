import mongoose from 'mongoose';

const studentEnrollmentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  academicYearId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicYear', required: true },
  academicYear: { type: String, required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  className: { type: String, required: true },
  sectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Section' },
  sectionName: { type: String },
  status: { type: String, required: true, enum: ['Active', 'Promoted', 'Graduated', 'Completed', 'Old'], default: 'Active' },
  joinedDate: { type: Date, default: Date.now },
  promotedDate: { type: Date }
}, { timestamps: true });

export default mongoose.model('StudentEnrollment', studentEnrollmentSchema);
