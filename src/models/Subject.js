import mongoose from 'mongoose';

const subjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  code: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    unique: true
  },
  category: {
    type: String,
    enum: ['Core', 'Language', 'Science/Lab', 'Activity', 'General'],
    default: 'Core'
  },
  color: {
    type: String,
    default: '#3B82F6' // hex color code
  },
  defaultWeeklyPeriods: {
    type: Number,
    default: 5,
    min: 1,
    max: 20
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

subjectSchema.index({ isActive: 1 });

export default mongoose.model('Subject', subjectSchema);
