import mongoose from 'mongoose';

const progressCardExamSchema = new mongoose.Schema({
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
    default: 'ALL',
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  displayOrder: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

progressCardExamSchema.index(
  { academicYear: 1, className: 1, name: 1 },
  { unique: true }
);

export default mongoose.model('ProgressCardExam', progressCardExamSchema);
