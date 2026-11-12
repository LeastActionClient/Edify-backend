import mongoose from 'mongoose';

const subjectScoreSchema = new mongoose.Schema({
  subject: { type: String, required: true, trim: true },
  mark: { type: mongoose.Schema.Types.Mixed, default: '' },
  grade: { type: String, default: '', trim: true }
}, { _id: false });

const coScholasticScoreSchema = new mongoose.Schema({
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
    trim: true,
    default: '2025 - 2026'
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
    default: () => [
      { subject: 'Tamil', mark: 57, grade: 'B' },
      { subject: 'English I', mark: 55, grade: 'B' },
      { subject: 'Maths', mark: 60, grade: 'B' },
      { subject: 'EVS', mark: 63, grade: 'B' },
      { subject: 'Com', mark: 83, grade: 'A' },
      { subject: 'Hindi', mark: 76, grade: 'B+' },
      { subject: 'ENGLISH II', mark: 54, grade: 'C' }
    ]
  },
  totalMarks: { type: mongoose.Schema.Types.Mixed, default: 448 },
  overallGrade: { type: String, default: 'B' },
  coScholastic: {
    type: [coScholasticScoreSchema],
    default: () => [
      { subject: 'G.K', grade: 'A' },
      { subject: 'V.E', grade: 'B' },
      { subject: 'ENGLISH DICTATION', grade: 'D' },
      { subject: 'TAMIL DICTATION', grade: 'D' },
      { subject: 'EVS DICTATION', grade: 'B+' }
    ]
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
