import mongoose from 'mongoose';

const timetableEntrySchema = new mongoose.Schema({
  timetableId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Timetable',
    required: true,
    index: true
  },
  academicYear: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  className: {
    type: String,
    required: true,
    trim: true
  },
  sectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Section',
    default: null
  },
  sectionName: {
    type: String,
    default: ''
  },
  day: {
    type: String,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    required: true
  },
  periodNumber: {
    type: Number,
    required: true
  },
  startTime: {
    type: String,
    default: ''
  },
  endTime: {
    type: String,
    default: ''
  },
  isBreak: {
    type: Boolean,
    default: false
  },
  breakTitle: {
    type: String,
    default: ''
  },
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    default: null
  },
  subjectName: {
    type: String,
    default: ''
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    default: null
  },
  teacherName: {
    type: String,
    default: ''
  },
  room: {
    type: String,
    default: ''
  }
}, { timestamps: true });

// 1. Prevent class clash: Only 1 allocation per class per day and period
timetableEntrySchema.index(
  { timetableId: 1, day: 1, periodNumber: 1 },
  { unique: true }
);

// 2. Strict Database-level Teacher Conflict Prevention:
// A teacher cannot be assigned to more than 1 class/section in the same day and period.
// Partial index applies ONLY when teacherId is a valid ObjectId (not null/break).
timetableEntrySchema.index(
  { academicYear: 1, day: 1, periodNumber: 1, teacherId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      teacherId: { $exists: true, $type: 'objectId' }
    }
  }
);

// Additional queries optimization
timetableEntrySchema.index({ academicYear: 1, teacherId: 1, day: 1 });
timetableEntrySchema.index({ academicYear: 1, classId: 1, sectionId: 1 });

export default mongoose.model('TimetableEntry', timetableEntrySchema);
