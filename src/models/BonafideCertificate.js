import mongoose from 'mongoose';

const bonafideCertificateSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true
    },
    admissionNumber: {
      type: String,
      required: true,
      trim: true
    },
    serialNo: {
      type: String,
      required: true,
      trim: true
    },
    certificateDate: {
      type: Date,
      default: Date.now
    },
    studentName: {
      type: String,
      required: true,
      trim: true
    },
    salutation: {
      type: String,
      default: 'Master',
      enum: ['Master', 'Miss', 'Master/Miss', 'Master/Miss.']
    },
    relation: {
      type: String,
      default: 'son of'
    },
    parentSalutation: {
      type: String,
      default: 'Mr'
    },
    parentName: {
      type: String,
      default: '',
      trim: true
    },
    statusText: {
      type: String,
      default: 'studying in'
    },
    classGrade: {
      type: String,
      default: '',
      trim: true
    },
    academicYear: {
      type: String,
      default: '',
      trim: true
    },
    dateOfBirth: {
      type: String,
      default: ''
    },
    additionalText: {
      type: String,
      default: ''
    },
    purpose: {
      type: String,
      default: ''
    },
    createdById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

bonafideCertificateSchema.index({ admissionNumber: 1 });
bonafideCertificateSchema.index({ serialNo: 1 });
bonafideCertificateSchema.index({ createdAt: -1 });

export default mongoose.model('BonafideCertificate', bonafideCertificateSchema);
