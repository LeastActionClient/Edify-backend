import mongoose from 'mongoose';

const classSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  defaultFees: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

export default mongoose.model('Class', classSchema);
