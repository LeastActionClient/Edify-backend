import mongoose from 'mongoose';

const subjectRequirementSchema = new mongoose.Schema({
  academicYear: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true,
    index: true
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
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: true,
    index: true
  },
  weeklyPeriods: {
    type: Number,
    required: true,
    default: 5,
    min: 1,
    max: 30
  },
  preferredTeacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    default: null
  },
  priority: {
    type: String,
    enum: ['High', 'Medium', 'Low'],
    default: 'Medium'
  },
  maxPerDay: {
    type: Number,
    default: 2,
    min: 1,
    max: 4
  }
}, { timestamps: true });

subjectRequirementSchema.index(
  { academicYear: 1, classId: 1, sectionId: 1, subjectId: 1 },
  { unique: true }
);

export default mongoose.model('SubjectRequirement', subjectRequirementSchema);
