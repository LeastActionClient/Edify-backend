import mongoose from 'mongoose';

const unavailableSlotSchema = new mongoose.Schema({
  day: {
    type: String,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    required: true
  },
  periodNumber: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    default: 'Unavailable'
  }
}, { _id: false });

const teacherAvailabilitySchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    required: true,
    index: true
  },
  academicYear: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  unavailableSlots: [unavailableSlotSchema],
  maxDailyPeriods: {
    type: Number,
    default: 6,
    min: 1,
    max: 12
  },
  maxWeeklyPeriods: {
    type: Number,
    default: 30,
    min: 1,
    max: 60
  }
}, { timestamps: true });

teacherAvailabilitySchema.index({ teacherId: 1, academicYear: 1 }, { unique: true });

export default mongoose.model('TeacherAvailability', teacherAvailabilitySchema);
