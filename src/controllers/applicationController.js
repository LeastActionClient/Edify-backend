import mongoose from 'mongoose';
import { Application, ActivityLog, Class, Section, StudentFee, Payment } from '../models/index.js';
import { createStudentWithGeneratedAdmissionNumber } from '../services/studentAdmissionService.js';
import { getCurrentApplicationNumber, reserveNextApplicationNumber, isDuplicateApplicationNumberError } from '../services/applicationNumberService.js';
import { isDuplicateAdmissionNumberError } from '../services/admissionNumberService.js';
import { getApplicationFeeAmount } from '../services/settingsService.js';

const getDuplicateConflict = (error) => {
  if (isDuplicateApplicationNumberError(error)) {
    return {
      status: 409,
      error: 'Application number already exists. Please try again.'
    };
  }

  if (isDuplicateAdmissionNumberError(error)) {
    return {
      status: 409,
      error: 'Admission number already exists. Please try again.'
    };
  }

  if (error?.code === 11000) {
    return {
      status: 409,
      error: 'Duplicate record detected. Please try again.'
    };
  }

  return null;
};

export const getNextNumbers = async (req, res) => {
  try {
    const nextAppId = await getCurrentApplicationNumber();
    res.json({ applicationNo: nextAppId });
  } catch (error) {
    res.status(500).json({ error: 'Error generating numbers' });
  }
};

export const createApplication = async (req, res) => {
  const {
    studentName, parentName, fatherName, motherName, fatherPhone, motherPhone,
    address, applyingClass, previousSchool, siblings, feePaid
  } = req.body;

  const isFeePaid = feePaid === true || feePaid === 'true';
  const feeAmount = isFeePaid ? await getApplicationFeeAmount() : 0;

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const applicationId = await reserveNextApplicationNumber(session);

      const [application] = await Application.create([{
        applicationId,
        studentName,
        parentName,
        fatherName,
        motherName,
        fatherPhone,
        motherPhone,
        address,
        applyingClass,
        previousSchool,
        siblings: siblings || null,
        feePaid: isFeePaid,
        feeAmount,
        feePaidDate: isFeePaid ? new Date() : null,
        processedById: req.user ? req.user.id : undefined
      }], { session });

      if (isFeePaid && feeAmount > 0) {
        try {
          await Payment.create([{
            applicationId: application._id,
            paymentType: 'APPLICATION',
            amount: feeAmount,
            paymentMethod: 'CASH',
            status: 'PAID',
            remarks: 'Application Fee for ' + applicationId,
            recordedById: req.user ? req.user.id : undefined
          }], { session });
        } catch (paymentErr) {
          console.error('Failed to record application fee payment:', paymentErr);
        }
      }

      if (req.user) {
        try {
          await ActivityLog.create([{
            userId: req.user.id,
            action: 'CREATED_APPLICATION',
            details: `Application ${applicationId} created for ${studentName}`
          }], { session });
        } catch (logErr) {
          console.error('Failed to create activity log:', logErr);
        }
      }

      await session.commitTransaction();
      res.status(201).json(application);
      return;
    } catch (error) {
      await session.abortTransaction();
      if (isDuplicateApplicationNumberError(error) && attempt < maxAttempts) {
        continue;
      }
      const conflict = getDuplicateConflict(error);
      if (conflict) {
        console.warn('Duplicate application number detected:', error?.message || error);
        res.status(conflict.status).json({ error: conflict.error });
        return;
      }
      console.error(error);
      res.status(500).json({ error: 'Error creating application' });
      return;
    } finally {
      session.endSession();
    }
  }
};

export const toggleFeeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { feePaid } = req.body;

    const application = await Application.findById(id);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    let feeAmount = application.feeAmount || 0;
    let feePaidDate = application.feePaidDate;

    if (feePaid && !application.feePaid) {
      feeAmount = await getApplicationFeeAmount();
      feePaidDate = new Date();
    } else if (!feePaid) {
      feeAmount = 0;
      feePaidDate = null;
    }

    const updatedApplication = await Application.findByIdAndUpdate(id, { feePaid, feeAmount, feePaidDate }, { new: true });

    res.json({ message: 'Fee status updated successfully', application: updatedApplication });
  } catch (error) {
    res.status(500).json({ error: 'Error updating fee status' });
  }
};

export const getApplications = async (req, res) => {
  try {
    const applications = await Application.find()
      .populate('processedById', 'username')
      .sort({ applicationDate: -1 });
    res.json(applications);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching applications' });
  }
};

export const getApplicationById = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await Application.findById(id).populate('processedById', 'username');
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    res.json(application);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching application' });
  }
};

export const approveApplication = async (req, res) => {
  const { id } = req.params;
  const { section } = req.body;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const application = await Application.findById(id).session(session);
      if (!application) {
        await session.abortTransaction();
        res.status(404).json({ error: 'Application not found' });
        return;
      }

      if (application.status === 'APPROVED') {
        await session.abortTransaction();
        res.status(400).json({ error: 'Application already approved' });
        return;
      }

      if (!section) {
        await session.abortTransaction();
        res.status(400).json({ error: 'Section must be assigned upon approval' });
        return;
      }

      const { student: newStudent, admissionNumber } = await createStudentWithGeneratedAdmissionNumber({
        applicationId: application._id,
        studentName: application.studentName,
        guardian: application.parentName,
        fatherName: application.fatherName,
        motherName: application.motherName,
        fatherPhone: application.fatherPhone,
        motherPhone: application.motherPhone,
        address: application.address,
        currentClass: application.applyingClass,
        section,
        siblings: application.siblings || null,
        addedById: req.user.id
      }, { session });

      const classData = await Class.findOne({ name: application.applyingClass }).session(session);

      if (classData) {
        let defaultFees = {};
        if (classData.defaultFees) {
          defaultFees = { ...classData.defaultFees };
        }

        const sectionData = await Section.findOne({ classId: classData._id, name: section }).session(session);
        if (sectionData && sectionData.defaultFees) {
          defaultFees = { ...defaultFees, ...sectionData.defaultFees };
        }

        const feeEntries = Object.entries(defaultFees);
        if (feeEntries.length > 0) {
          await StudentFee.insertMany(
            feeEntries.map(([feeCategoryId, amount]) => ({
              studentId: newStudent._id,
              feeCategoryId,
              totalAmount: amount,
              remainingAmount: amount
            })),
            { session }
          );
        }
      }

      await Application.findByIdAndUpdate(
        id,
        {
          status: 'APPROVED',
          processedById: req.user.id,
          approvedBy: req.user.id,
          approvedAt: new Date(),
          adminNo: admissionNumber,
          student: newStudent._id
        },
        { new: true, session }
      );

      await ActivityLog.create([{
        userId: req.user.id,
        action: 'APPROVED_APPLICATION',
        details: `Application ${application.applicationId} approved. Student ${admissionNumber} created.`
      }], { session });

      await session.commitTransaction();

      res.json({
        success: true,
        message: 'Application approved successfully',
        admissionNumber,
        data: newStudent
      });
      return;
    } catch (error) {
      await session.abortTransaction();
      if ((isDuplicateAdmissionNumberError(error) || isDuplicateApplicationNumberError(error)) && attempt < maxAttempts) {
        continue;
      }
      const conflict = getDuplicateConflict(error);
      if (conflict) {
        console.warn('Duplicate admission number detected:', error?.message || error);
        res.status(conflict.status).json({ error: conflict.error });
        return;
      }
      console.error('Error approving application', error);
      res.status(500).json({ error: 'Error approving application' });
      return;
    } finally {
      session.endSession();
    }
  }
};

export const deleteApplication = async (req, res) => {
  try {
    const { id } = req.params;
    await Application.findByIdAndDelete(id);
    res.json({ message: 'Application deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting application' });
  }
};
