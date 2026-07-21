import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, unique: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  generatedDate: { type: Date, default: Date.now }
}, { timestamps: true });

invoiceSchema.index({ studentId: 1, generatedDate: -1 });
invoiceSchema.index({ paymentId: 1, generatedDate: -1 });

export default mongoose.model('Invoice', invoiceSchema);
