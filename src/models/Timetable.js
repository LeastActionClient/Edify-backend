import mongoose from 'mongoose';

const timetableSchema = new mongoose.Schema({
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
  status: {
    type: String,
    enum: ['Draft', 'Published'],
    default: 'Draft',
    index: true
  },
  isPublished: {
    type: Boolean,
    default: false,
    index: true
  },
  publishedAt: {
    type: Date,
    default: null
  },
  publishedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, { timestamps: true });

timetableSchema.index(
  { academicYear: 1, classId: 1, sectionId: 1 },
  { unique: true }
);

export default mongoose.model('Timetable', timetableSchema);
