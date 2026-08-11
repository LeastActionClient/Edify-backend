import mongoose from 'mongoose';

const teacherSchema = new mongoose.Schema({
  teacherId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  designation: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  address: { type: String, required: true },
  photo: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('Teacher', teacherSchema);
