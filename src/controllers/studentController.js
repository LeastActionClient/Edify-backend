import prisma from '../utils/prisma.js';
import fs from 'fs';
import path from 'path';

export const getStudents = async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        addedBy: {
          select: { username: true }
        },
        studentFees: {
          include: { feeCategory: true }
        }
      }
    });
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching students' });
  }
};

export const getStudentById = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await prisma.student.findUnique({
      where: { id: id  },
      include: {
        addedBy: {
          select: { username: true }
        },
        studentFees: {
          include: { feeCategory: true }
        },
        payments: {
          orderBy: { paymentDate: 'desc' }
        },
        includedCharges: {
          include: { includedCharge: true }
        },
        activities: {
          include: { activity: true }
        }
      }
    });

    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    res.json(student);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching student details' });
  }
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

export const addStudentManually = async (req, res) => {
  try {
    const { studentName, fatherName, motherName, fatherPhone, motherPhone, address, currentClass, section, admissionNumber: reqAdmissionNumber } = req.body;

    if (!studentName || !currentClass) {
      res.status(400).json({ error: 'Student Name and Class are required' });
      return;
    }

    const admissionNumber = reqAdmissionNumber || await generateAdmissionNumber();

    const student = await prisma.student.create({
      data: {
        admissionNumber,
        studentName,
        fatherName: fatherName || '',
        motherName: motherName || '',
        fatherPhone: fatherPhone || '',
        motherPhone: motherPhone || '',
        address: address || '',
        currentClass,
        section,
        addedById: req.user?.id
      }
    });

    if (req.user) {
      await prisma.activityLog.create({
        data: {
          userId: req.user.id,
          action: 'CREATED_STUDENT_MANUALLY',
          details: `Student ${admissionNumber} created manually for class ${currentClass}`
        }
      });
    }

    res.status(201).json(student);
  } catch (error) {
    console.error("Manual add error:", error);
    res.status(500).json({ error: 'Error adding student manually' });
  }
};

import xlsx from 'xlsx';

export const bulkImportStudents = async (req, res) => {
  try {
    const { currentClass, section } = req.body;

    if (!currentClass) {
      res.status(400).json({ error: 'Class is required for bulk import' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No Excel file provided' });
      return;
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Parse the sheet to JSON
    const data = xlsx.utils.sheet_to_json(sheet);

    if (data.length === 0) {
      res.status(400).json({ error: 'Excel file is empty' });
      return;
    }

    let successCount = 0;
    const errors = [];

    // Process each row
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const studentName = row['Student Name'] || row['Name'] || row['studentName'];
      
      if (!studentName) {
        errors.push(`Row ${i + 2}: Student Name is missing.`);
        continue;
      }

      const admissionNumber = row['Admission No'] || row['admissionNumber'] || await generateAdmissionNumber();

      try {
        await prisma.student.create({
          data: {
            admissionNumber: String(admissionNumber),
            studentName: String(studentName),
            fatherName: String(row['Father Name'] || row['fatherName'] || ''),
            motherName: String(row['Mother Name'] || row['motherName'] || ''),
            fatherPhone: String(row['Father Phone'] || row['fatherPhone'] || ''),
            motherPhone: String(row['Mother Phone'] || row['motherPhone'] || ''),
            address: String(row['Address'] || row['address'] || ''),
            gender: String(row['Gender'] || row['Sex'] || row['gender'] || ''),
            bloodGroup: String(row['Blood Group'] || row['bloodGroup'] || ''),
            aadhaarNumber: String(row['Aadhar No'] || row['Aadhaar Number'] || row['aadhaarNumber'] || ''),
            religion: String(row['Religion'] || row['religion'] || ''),
            community: String(row['Community'] || row['Caste'] || row['community'] || ''),
            nationality: String(row['Nationality'] || row['nationality'] || ''),
            fatherOccupation: String(row['Father Occupation'] || row['fatherOccupation'] || ''),
            motherOccupation: String(row['Mother Occupation'] || row['motherOccupation'] || ''),
            guardian: String(row['Guardian Name'] || row['guardian'] || ''),
            city: String(row['City'] || row['city'] || ''),
            state: String(row['State'] || row['state'] || ''),
            pincode: String(row['Pincode'] || row['pincode'] || ''),
            dateOfBirth: (row['Date of Birth'] || row['DOB']) ? new Date(row['Date of Birth'] || row['DOB']) : null,
            currentClass,
            section: section || null,
            addedById: req.user?.id
          }
        });
        successCount++;
      } catch (err) {
        if (err.code === 'P2002') {
          errors.push(`Row ${i + 2}: Admission Number ${admissionNumber} already exists.`);
        } else {
          errors.push(`Row ${i + 2}: Error saving to DB.`);
        }
      }
    }

    if (req.user && successCount > 0) {
      await prisma.activityLog.create({
        data: {
          userId: req.user.id,
          action: 'BULK_IMPORT_STUDENTS',
          details: `Imported ${successCount} students into class ${currentClass}`
        }
      });
    }

    res.status(201).json({
      message: `Successfully imported ${successCount} students.`,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error("Bulk import error:", error);
    res.status(500).json({ error: 'Error importing students from Excel' });
  }
};

export const deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;
    
    await prisma.$transaction(async (tx) => {
      await tx.invoice.deleteMany({ where: { studentId: id } });
      await tx.payment.deleteMany({ where: { studentId: id } });
      await tx.studentFee.deleteMany({ where: { studentId: id } });
      await tx.student.delete({ where: { id } });
    });
    
    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'DELETED_STUDENT',
        details: `Deleted student ${id} and all associated records`
      }
    });

    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    console.error("Delete student error:", error);
    res.status(500).json({ error: 'Error deleting student. Financial records might be preventing deletion.' });
  }
};

export const removeFeeFromStudent = async (req, res) => {
  try {
    const { studentId, feeId } = req.params;
    
    // Ensure the fee belongs to the student and has no payments against it yet
    const fee = await prisma.studentFee.findFirst({
      where: { id: feeId, studentId: studentId }
    });

    if (!fee) {
      return res.status(404).json({ error: 'Fee assignment not found' });
    }

    if (fee.paidAmount > 0) {
      return res.status(400).json({ error: 'Cannot delete a fee that has already been partially or fully paid' });
    }
    await prisma.studentFee.delete({
      where: { id: feeId }
    });

    res.json({ message: 'Fee assignment removed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error removing fee assignment' });
  }
};

export const updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      studentName, fatherName, motherName, fatherPhone, motherPhone, address, currentClass, section,
      admissionNumber, dateOfBirth, gender, bloodGroup, aadhaarNumber, religion, community,
      nationality, email, rollNumber, admissionDate, academicYear, studentStatus,
      fatherOccupation, motherOccupation, guardian, city, state, pincode, photoUrl,
      baseFee, includedChargesTotal, activitiesTotal, grandTotal,
      includedChargesIds, activitiesIds
    } = req.body;

    const student = await prisma.$transaction(async (tx) => {
      // 1. Update basic fields
      const updatedStudent = await tx.student.update({
        where: { id },
        data: {
          studentName, fatherName, motherName, fatherPhone, motherPhone, address, currentClass, section,
          admissionNumber, gender, bloodGroup, aadhaarNumber, religion, community,
          nationality, email, rollNumber, academicYear, studentStatus,
          fatherOccupation, motherOccupation, guardian, city, state, pincode, photoUrl,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          admissionDate: admissionDate ? new Date(admissionDate) : null,
          baseFee: baseFee ? parseFloat(baseFee) : null,
          includedChargesTotal: includedChargesTotal ? parseFloat(includedChargesTotal) : null,
          activitiesTotal: activitiesTotal ? parseFloat(activitiesTotal) : null,
          grandTotal: grandTotal ? parseFloat(grandTotal) : null,
        }
      });

      // 2. Sync Included Charges
      if (Array.isArray(includedChargesIds)) {
        await tx.studentIncludedCharge.deleteMany({ where: { studentId: id } });
        if (includedChargesIds.length > 0) {
          await tx.studentIncludedCharge.createMany({
            data: includedChargesIds.map(chargeId => ({
              studentId: id,
              includedChargeId: chargeId
            }))
          });
        }
      }

      // 3. Sync Activities
      if (Array.isArray(activitiesIds)) {
        await tx.studentActivity.deleteMany({ where: { studentId: id } });
        if (activitiesIds.length > 0) {
          await tx.studentActivity.createMany({
            data: activitiesIds.map(activityId => ({
              studentId: id,
              activityId: activityId
            }))
          });
        }
      }

      return updatedStudent;
    });

    if (req.user) {
      await prisma.activityLog.create({
        data: {
          userId: req.user.id,
          action: 'UPDATED_STUDENT',
          details: `Updated full details for student ${id}`
        }
      });
    }

    res.json(student);
  } catch (error) {
    console.error("Update student error:", error);
    res.status(500).json({ error: 'Error updating student details' });
  }
};
