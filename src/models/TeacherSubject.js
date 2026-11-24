import mongoose from 'mongoose';

const teacherSubjectSchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    required: true,
    index: true
  },
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: true,
    index: true
  },
  // Optional: restrict to specific classes (empty means any class)
  classes: [{
    type: String,
    trim: true
  }],
  maxWeeklyPeriods: {
    type: Number,
    default: 30,
    min: 1,
    max: 60
  }
}, { timestamps: true });

teacherSubjectSchema.index({ teacherId: 1, subjectId: 1 }, { unique: true });

export default mongoose.model('TeacherSubject', teacherSubjectSchema);
