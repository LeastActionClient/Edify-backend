import mongoose from 'mongoose';

const subjectScoreSchema = new mongoose.Schema({
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgressCardSubject' },
  subject: { type: String, required: true, trim: true },
  maxMarks: { type: Number, default: 100 },
  mark: { type: mongoose.Schema.Types.Mixed, default: '' },
  grade: { type: String, default: '', trim: true }
}, { _id: false });

const coScholasticScoreSchema = new mongoose.Schema({
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgressCardSubject' },
  subject: { type: String, required: true, trim: true },
  grade: { type: String, default: '', trim: true }
}, { _id: false });

const progressCardSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
    index: true
  },
  academicYear: {
    type: String,
    required: true,
    trim: true
  },
  term: {
    type: String,
    required: true,
    trim: true,
    default: 'TERM - II'
  },
  currentClass: {
    type: String,
    required: true,
    trim: true
  },
  section: {
    type: String,
    required: true,
    trim: true,
    default: 'A'
  },
  attendance: {
    totalWorkingDays: { type: Number, default: 0 },
    studentAttendance: { type: Number, default: 0 }
  },
  healthStatus: {
    bloodGroup: { type: String, default: '' },
    height: { type: String, default: '' },
    weight: { type: String, default: '' },
    dentalHygiene: { type: String, default: '' }
  },
  scholastic: {
    type: [subjectScoreSchema],
    default: []
  },
  totalMarks: { type: mongoose.Schema.Types.Mixed, default: '' },
  overallGrade: { type: String, default: '' },
  coScholastic: {
    type: [coScholasticScoreSchema],
    default: []
  },
  selfAwareness: {
    goals: { type: String, default: '' },
    strengths: { type: String, default: '' },
    interestsHobbies: { type: String, default: '' },
    responsibilitiesAchievements: { type: String, default: '' }
  },
  teacherRemarks: { type: String, default: '' }
}, {
  timestamps: true
});

progressCardSchema.index({ studentId: 1, academicYear: 1, term: 1 }, { unique: true });

export default mongoose.model('ProgressCard', progressCardSchema);
