import { Application, Student, ActivityLog, Class, Section, StudentFee } from '../models/index.js';
import fs from 'fs';
import path from 'path';

const generateApplicationId = async () => {
  const currentYear = new Date().getFullYear();

  try {
    const settingsPath = path.join(process.cwd(), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.nextApplicationNo) {
        const nextNo = settings.nextApplicationNo;
        const parts = nextNo.split('-');
        if (parts.length >= 2) {
          const lastNumStr = parts[parts.length - 1];
          const lastNum = parseInt(lastNumStr, 10);
          if (!isNaN(lastNum)) {
            const prefix = parts.slice(0, parts.length - 1).join('-');
            const paddingLength = lastNumStr.length > 0 ? lastNumStr.length : 4;
            settings.nextApplicationNo = `${prefix}-${String(lastNum + 1).padStart(paddingLength, '0')}`;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
          }
        }
        return nextNo;
      }
    }
  } catch(e) {}

  const latestApp = await Application.findOne().sort({ createdAt: -1 });

  if (!latestApp) return `APP-${currentYear}-0001`;

  const parts = latestApp.applicationId.split('-');
  if (parts.length >= 2) {
    const lastNumStr = parts[parts.length - 1];
    const lastNum = parseInt(lastNumStr, 10);

    if (!isNaN(lastNum)) {
      const prefix = parts.slice(0, parts.length - 1).join('-');
      const paddingLength = lastNumStr.length > 0 ? lastNumStr.length : 4;
      return `${prefix}-${String(lastNum + 1).padStart(paddingLength, '0')}`;
    }
  }

  return `APP-${currentYear}-0001`;
};

const generateAdmissionNumber = async () => {
  const currentYear = new Date().getFullYear();

  try {
    const settingsPath = path.join(process.cwd(), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.nextAdmissionNo) {
        const nextNo = settings.nextAdmissionNo;
        const parts = nextNo.split('-');
        if (parts.length >= 2) {
          const lastNumStr = parts[parts.length - 1];
          const lastNum = parseInt(lastNumStr, 10);
          if (!isNaN(lastNum)) {
            const prefix = parts.slice(0, parts.length - 1).join('-');
            const paddingLength = lastNumStr.length > 0 ? lastNumStr.length : 4;
            settings.nextAdmissionNo = `${prefix}-${String(lastNum + 1).padStart(paddingLength, '0')}`;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
          }
        }
        return nextNo;
      }
    }
  } catch(e) {}

  const latestStudent = await Student.findOne().sort({ createdAt: -1 });

  const latestApp = await Application.findOne({ adminNo: { $ne: null } }).sort({ createdAt: -1 });

  let latestRecord = null;
  let numberStr = null;

  if (latestStudent && latestApp) {
    if (latestStudent.createdAt > latestApp.createdAt) {
      latestRecord = latestStudent;
      numberStr = latestStudent.admissionNumber;
    } else {
      latestRecord = latestApp;
      numberStr = latestApp.adminNo;
    }
  } else if (latestStudent) {
    latestRecord = latestStudent;
    numberStr = latestStudent.admissionNumber;
  } else if (latestApp) {
    latestRecord = latestApp;
    numberStr = latestApp.adminNo;
  }

  if (!latestRecord || !numberStr) return `ADM-${currentYear}-0001`;

  const parts = numberStr.split('-');
  if (parts.length >= 2) {
    const lastNumStr = parts[parts.length - 1];
    const lastNum = parseInt(lastNumStr, 10);

    if (!isNaN(lastNum)) {
      const prefix = parts.slice(0, parts.length - 1).join('-');
      const paddingLength = lastNumStr.length > 0 ? lastNumStr.length : 4;
      return `${prefix}-${String(lastNum + 1).padStart(paddingLength, '0')}`;
    }
  }

  return `ADM-${currentYear}-0001`;
};

export const getNextNumbers = async (req, res) => {
  try {
    const nextAppId = await generateApplicationId();
    const nextAdminId = await generateAdmissionNumber();
    res.json({ applicationNo: nextAppId, adminNo: nextAdminId });
  } catch (error) {
    res.status(500).json({ error: 'Error generating numbers' });
  }
};

export const createApplication = async (req, res) => {
  try {
    const {
      applicationNo, adminNo,
      studentName, fatherName, motherName, fatherPhone, motherPhone,
      address, applyingClass, previousSchool, siblings, feePaid
    } = req.body;

    const applicationId = applicationNo || await generateApplicationId();
    const finalAdminNo = adminNo || await generateAdmissionNumber();

    const application = await Application.create({
      applicationId,
      adminNo: finalAdminNo,
      studentName,
      fatherName,
      motherName,
      fatherPhone,
      motherPhone,
      address,
      applyingClass,
      previousSchool,
      siblings: siblings || null,
      feePaid: feePaid === true || feePaid === 'true',
      processedById: req.user ? req.user.id : undefined
    });

    if (req.user) {
      await ActivityLog.create({
        userId: req.user.id,
        action: 'CREATED_APPLICATION',
        details: `Application ${applicationId} created for ${studentName}`
      });
    }

    res.status(201).json(application);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error creating application' });
  }
};

export const toggleFeeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { feePaid } = req.body;

    const application = await Application.findByIdAndUpdate(id, { feePaid }, { new: true });

    res.json({ message: 'Fee status updated successfully', application });
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

export const approveApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { section } = req.body;

    const application = await Application.findById(id);
    if (!application) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    if (application.status === 'APPROVED') {
      res.status(400).json({ error: 'Application already approved' });
      return;
    }

    if (!section) {
      res.status(400).json({ error: 'Section must be assigned upon approval' });
      return;
    }

    const admissionNumber = application.adminNo || await generateAdmissionNumber();

    const updatedApp = await Application.findByIdAndUpdate(
      id,
      { status: 'APPROVED', processedById: req.user.id },
      { new: true }
    );
    const newStudent = await Student.create({
      admissionNumber,
      applicationId: application._id,
      studentName: application.studentName,
      fatherName: application.fatherName,
      motherName: application.motherName,
      fatherPhone: application.fatherPhone,
      motherPhone: application.motherPhone,
      address: application.address,
      currentClass: application.applyingClass,
      section: section,
      siblings: application.siblings || null,
      addedById: req.user.id
    });

    const classData = await Class.findOne({ name: application.applyingClass });

    if (classData) {
      let defaultFees = {};
      if (classData.defaultFees) {
        defaultFees = { ...classData.defaultFees };
      }

      const sectionData = await Section.findOne({ classId: classData._id, name: section });
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
          }))
        );
      }
    }

    await ActivityLog.create({
      userId: req.user.id,
      action: 'APPROVED_APPLICATION',
      details: `Application ${application.applicationId} approved. Student ${admissionNumber} created.`
    });

    res.json({ message: 'Application approved successfully', student: newStudent });
  } catch (error) {
    res.status(500).json({ error: 'Error approving application' });
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
