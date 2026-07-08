import prisma from '../utils/prisma.js';
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
        // Auto increment for next time
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

  const latestApp = await prisma.application.findFirst({
    orderBy: { createdAt: 'desc' }
  });

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
        // Auto increment for next time
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

  const latestStudent = await prisma.student.findFirst({
    orderBy: { createdAt: 'desc' }
  });

  const latestApp = await prisma.application.findFirst({
    where: { adminNo: { not: null } },
    orderBy: { createdAt: 'desc' }
  });

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

    const application = await prisma.application.create({
      data: {
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
      }
    });

    if (req.user) {
      await prisma.activityLog.create({
        data: {
          userId: req.user.id,
          action: 'CREATED_APPLICATION',
          details: `Application ${applicationId} created for ${studentName}`
        }
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

    const application = await prisma.application.update({
      where: { id: id },
      data: { feePaid: feePaid }
    });

    res.json({ message: 'Fee status updated successfully', application });
  } catch (error) {
    res.status(500).json({ error: 'Error updating fee status' });
  }
};

export const getApplications = async (req, res) => {
  try {
    const applications = await prisma.application.findMany({
      include: {
        processedBy: { select: { username: true } }
      },
      orderBy: { applicationDate: 'desc' }
    });
    res.json(applications);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching applications' });
  }
};

export const approveApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { section } = req.body;

    const application = await prisma.application.findUnique({ where: { id: id  } });
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

    // Transaction to approve application and create student
    const [updatedApp, newStudent] = await prisma.$transaction([
      prisma.application.update({
        where: { id: id  },
        data: { 
          status: 'APPROVED',
          processedById: req.user.id
        }
      }),
      prisma.student.create({
        data: {
          admissionNumber,
          applicationId: application.id,
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
        }
      })
    ]);

    // Apply default fees if any
    const classData = await prisma.class.findUnique({
      where: { name: application.applyingClass },
      include: { sections: { where: { name: section } } }
    });

    if (classData) {
      let defaultFees = {};
      if (classData.defaultFees) {
        defaultFees = { ...classData.defaultFees };
      }
      if (classData.sections && classData.sections.length > 0 && classData.sections[0].defaultFees) {
        defaultFees = { ...defaultFees, ...classData.sections[0].defaultFees };
      }

      const feeEntries = Object.entries(defaultFees);
      if (feeEntries.length > 0) {
        await prisma.studentFee.createMany({
          data: feeEntries.map(([feeCategoryId, amount]) => ({
            studentId: newStudent.id,
            feeCategoryId,
            totalAmount: amount,
            remainingAmount: amount
          }))
        });
      }
    }

    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'APPROVED_APPLICATION',
        details: `Application ${application.applicationId} approved. Student ${admissionNumber} created.`
      }
    });

    res.json({ message: 'Application approved successfully', student: newStudent });
  } catch (error) {
    res.status(500).json({ error: 'Error approving application' });
  }
};

export const deleteApplication = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.application.delete({ where: { id } });
    res.json({ message: 'Application deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting application' });
  }
};
