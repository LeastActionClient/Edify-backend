import mongoose from 'mongoose';

const periodSlotSchema = new mongoose.Schema({
  periodNumber: {
    type: Number,
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  startTime: {
    type: String,
    required: true,
    trim: true
  },
  endTime: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['teaching', 'break', 'lunch', 'assembly'],
    default: 'teaching'
  },
  isBreak: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const timetableConfigSchema = new mongoose.Schema({
  academicYear: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    default: null
  },
  className: {
    type: String,
    default: 'All'
  },
  workingDays: {
    type: [String],
    default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  },
  periods: [periodSlotSchema]
}, { timestamps: true });

// One default config per academicYear (where classId is null), and at most one specific config per class
timetableConfigSchema.index({ academicYear: 1, classId: 1 }, { unique: true });

export default mongoose.model('TimetableConfig', timetableConfigSchema);
