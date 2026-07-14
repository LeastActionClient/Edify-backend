import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  paymentType: { type: String, enum: ['FEE', 'APPLICATION'], default: 'FEE' },
  studentFeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentFee' }, // Optional for full payments
  isFullPayment: { type: Boolean, default: false },
  feeAllocations: [{
    studentFeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentFee' },
    amount: Number
  }],
  amount: { type: Number, required: true },
  paymentDate: { type: Date, default: Date.now },
  paymentMethod: { type: String, required: true },
  referenceNumber: { type: String },
  remarks: { type: String },
  status: { type: String, enum: ['PENDING', 'PARTIAL', 'PAID'], default: 'PAID' },
  recordedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

export default mongoose.model('Payment', paymentSchema);
