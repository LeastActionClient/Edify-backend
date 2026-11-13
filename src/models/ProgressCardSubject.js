import mongoose from 'mongoose';

const progressCardSubjectSchema = new mongoose.Schema({
  academicYear: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  className: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  category: {
    type: String,
    enum: ['scholastic', 'coScholastic'],
    required: true,
    default: 'scholastic'
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  maxMarks: {
    type: Number,
    default: 100,
    min: 1
  },
  displayOrder: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

progressCardSubjectSchema.index(
  { academicYear: 1, className: 1, category: 1, name: 1 },
  { unique: true }
);

export default mongoose.model('ProgressCardSubject', progressCardSubjectSchema);
