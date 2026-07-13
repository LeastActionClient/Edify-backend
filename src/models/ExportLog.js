import mongoose from 'mongoose';

const exportLogSchema = new mongoose.Schema({
  exportScope: {
    type: String,
    required: true
  },
  exportType: {
    type: String,
    enum: ['PDF', 'Excel'],
    required: true
  },
  exportFilters: {
    type: mongoose.Schema.Types.Mixed
  },
  exportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  ipAddress: {
    type: String
  },
  numberOfStudentsExported: {
    type: Number,
    required: true
  }
}, {
  timestamps: { createdAt: 'exportDate', updatedAt: false }
});

export default mongoose.model('ExportLog', exportLogSchema);
