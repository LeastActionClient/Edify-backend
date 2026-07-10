import { Application, Student, ActivityLog, StudentFee, StudentIncludedCharge, StudentActivity, Payment, Invoice, FeeCategory, Class, Section } from '../models/index.js';
import fs from 'fs';
import path from 'path';

export const assignClassDefaultFeesToStudent = async (student) => {
  try {
    const studentId = student._id;
    const currentClass = student.currentClass;
    const section = student.section;

    // Find class default fees
    let defaultFees = {};
    const classDoc = await Class.findOne({ name: currentClass });
    if (classDoc) {
      if (section) {
        const sectionDoc = await Section.findOne({ name: section, classId: classDoc._id });
        if (sectionDoc && sectionDoc.defaultFees && Object.keys(sectionDoc.defaultFees).length > 0) {
          defaultFees = sectionDoc.defaultFees;
        } else if (classDoc.defaultFees) {
          defaultFees = classDoc.defaultFees;
        }
      } else if (classDoc.defaultFees) {
        defaultFees = classDoc.defaultFees;
      }
    }

    // Get all mandatory fee categories and Uniform category
    const categories = await FeeCategory.find();
    const validCatMap = new Map(categories.map(c => [c._id.toString(), c]));

    let baseFeeTotal = 0;

    // For this student, we assign all mandatory categories and Uniform if defined in class/section defaultFees
    for (const catId of Object.keys(defaultFees)) {
      const cat = validCatMap.get(catId);
      if (!cat) continue;

      const isMandatory = cat.mandatory;
      const isUniform = cat.name.toLowerCase() === 'uniform';

      if (isMandatory || isUniform) {
        const feeConfig = defaultFees[catId];
        let amount = 0;
        let uniformDetailsToSave = undefined;

        if (isUniform) {
          amount = 0; // starts at 0 since lengths are 0
          uniformDetailsToSave = { topLength: 0, bottomLength: 0 };
        } else {
          amount = typeof feeConfig === 'number' ? feeConfig : parseFloat(feeConfig?.amount || 0);
        }

        if (isUniform) {
          const existing = await StudentFee.findOne({ studentId, feeCategoryId: catId });
          if (!existing) {
            await StudentFee.create({
              studentId,
              feeCategoryId: catId,
              totalAmount: amount,
              remainingAmount: amount,
              paidAmount: 0,
              uniformDetails: uniformDetailsToSave
            });
          }
        } else if (amount > 0) {
          baseFeeTotal += amount;
          const existing = await StudentFee.findOne({ studentId, feeCategoryId: catId });
          if (existing) {
            existing.totalAmount = amount;
            existing.remainingAmount = Math.max(0, amount - existing.paidAmount);
            await existing.save();
          } else {
            await StudentFee.create({
              studentId,
              feeCategoryId: catId,
              totalAmount: amount,
              remainingAmount: amount,
              paidAmount: 0
            });
          }
        }
      }
    }

    // Update student's baseFee and grandTotal
    await Student.findByIdAndUpdate(studentId, {
      baseFee: baseFeeTotal,
      grandTotal: baseFeeTotal
    });
  } catch (error) {
    console.error("Error assigning class default fees to student", error);
  }
};

export const getStudents = async (req, res) => {
  try {
    const students = await Student.find()
      .populate('addedById', 'username')
      .sort({ createdAt: -1 })
      .lean();

    const studentIds = students.map(s => s._id);
    const studentFees = await StudentFee.find({ studentId: { $in: studentIds } })
      .populate('feeCategoryId')
      .lean();

    const feeMap = {};
    studentFees.forEach(fee => {
      fee.feeCategory = fee.feeCategoryId; // Map populated field for frontend
      const sid = fee.studentId.toString();
      if (!feeMap[sid]) feeMap[sid] = [];
      feeMap[sid].push(fee);
    });

    const result = students.map(s => ({
      ...s,
      studentFees: feeMap[s._id.toString()] || []
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching students' });
  }
};

export const getStudentById = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await Student.findById(id)
      .populate('addedById', 'username')
      .lean();

    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    const studentFeesRaw = await StudentFee.find({ studentId: id })
      .populate('feeCategoryId')
      .lean();
      
    const studentFees = studentFeesRaw.map(fee => ({
      ...fee,
      feeCategory: fee.feeCategoryId
    }));

    const payments = await Payment.find({ studentId: id })
      .sort({ paymentDate: -1 })
      .lean();

    const includedCharges = await StudentIncludedCharge.find({ studentId: id })
      .populate('includedChargeId')
      .lean();

    const activities = await StudentActivity.find({ studentId: id })
      .populate('activityId')
      .lean();

    res.json({ ...student, studentFees, payments, includedCharges, activities });
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

export const addStudentManually = async (req, res) => {
  try {
    const { 
      studentName, fatherName, motherName, fatherPhone, motherPhone, address, 
      currentClass, section, admissionNumber: reqAdmissionNumber,
      dateOfBirth, gender, bloodGroup, aadhaarNumber, religion, community, caste, rcc, nationality,
      fatherOccupation, motherOccupation, guardian, city, state, pincode, whatsappNumber, emisNumber
    } = req.body;

    if (!studentName || !currentClass) {
      res.status(400).json({ error: 'Student Name and Class are required' });
      return;
    }

    const admissionNumber = reqAdmissionNumber || await generateAdmissionNumber();

    const student = await Student.create({
      admissionNumber,
      studentName,
      fatherName: fatherName || '',
      motherName: motherName || '',
      fatherPhone: fatherPhone || '',
      motherPhone: motherPhone || '',
      address: address || '',
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      gender: gender || '',
      bloodGroup: bloodGroup || '',
      aadhaarNumber: aadhaarNumber || '',
      religion: religion || '',
      community: community || '',
      caste: caste || '',
      rcc: rcc || '',
      nationality: nationality || '',
      fatherOccupation: fatherOccupation || '',
      motherOccupation: motherOccupation || '',
      guardian: guardian || '',
      city: city || '',
      state: state || '',
      pincode: pincode || '',
      whatsappNumber: whatsappNumber || '',
      emisNumber: emisNumber || '',
      currentClass,
      section,
      addedById: req.user?.id
    });

    await assignClassDefaultFeesToStudent(student);

    if (req.user) {
      await ActivityLog.create({
        userId: req.user.id,
        action: 'CREATED_STUDENT_MANUALLY',
        details: `Student ${admissionNumber} created manually for class ${currentClass}`
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

    const data = xlsx.utils.sheet_to_json(sheet);

    if (data.length === 0) {
      res.status(400).json({ error: 'Excel file is empty' });
      return;
    }

    let successCount = 0;
    const errors = [];
    let nextAdmNo = null;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const studentName = row['Student Name'] || row['Name'] || row['studentName'];

      if (!studentName) {
        errors.push(`Row ${i + 2}: Student Name is missing.`);
        continue;
      }

      let admissionNumber = row['Admission No'] || row['admissionNumber'];
      
      if (!admissionNumber) {
        if (!nextAdmNo) {
          nextAdmNo = await generateAdmissionNumber();
        } else {
          const parts = nextAdmNo.split('-');
          if (parts.length >= 2) {
            const lastNumStr = parts[parts.length - 1];
            const lastNum = parseInt(lastNumStr, 10);
            if (!isNaN(lastNum)) {
              const prefix = parts.slice(0, parts.length - 1).join('-');
              const paddingLength = lastNumStr.length > 0 ? lastNumStr.length : 4;
              nextAdmNo = `${prefix}-${String(lastNum + 1).padStart(paddingLength, '0')}`;
            } else {
              nextAdmNo = await generateAdmissionNumber();
            }
          } else {
            nextAdmNo = await generateAdmissionNumber();
          }
        }
        admissionNumber = nextAdmNo;
      }

      try {
        const student = await Student.create({
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
          community: String(row['Community'] || row['community'] || ''),
          caste: String(row['Caste'] || row['caste'] || ''),
          rcc: String(row['RCC'] || row['rcc'] || ''),
          nationality: String(row['Nationality'] || row['nationality'] || ''),
          fatherOccupation: String(row['Father Occupation'] || row['fatherOccupation'] || ''),
          motherOccupation: String(row['Mother Occupation'] || row['motherOccupation'] || ''),
          guardian: String(row['Guardian Name'] || row['guardian'] || ''),
          city: String(row['City'] || row['city'] || ''),
          state: String(row['State'] || row['state'] || ''),
          pincode: String(row['Pincode'] || row['pincode'] || ''),
          dateOfBirth: (row['Date of Birth'] || row['DOB']) ? new Date(row['Date of Birth'] || row['DOB']) : null,
          whatsappNumber: String(row['Whatsapp Number'] || row['whatsappNumber'] || row['Whatsapp No'] || ''),
          emisNumber: String(row['EMIS No'] || row['emisNumber'] || row['EMIS Number'] || ''),
          currentClass,
          section: section || null,
          addedById: req.user?.id
        });
        await assignClassDefaultFeesToStudent(student);
        successCount++;
      } catch (err) {
        if (err.code === 11000) {
          errors.push(`Row ${i + 2}: Admission Number ${admissionNumber} already exists.`);
        } else {
          errors.push(`Row ${i + 2}: Error saving to DB.`);
        }
      }
    }

    if (req.user && successCount > 0) {
      await ActivityLog.create({
        userId: req.user.id,
        action: 'BULK_IMPORT_STUDENTS',
        details: `Imported ${successCount} students into class ${currentClass}`
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

    await Invoice.deleteMany({ studentId: id });
    await Payment.deleteMany({ studentId: id });
    await StudentFee.deleteMany({ studentId: id });
    await Student.findByIdAndDelete(id);

    await ActivityLog.create({
      userId: req.user.id,
      action: 'DELETED_STUDENT',
      details: `Deleted student ${id} and all associated records`
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

    const fee = await StudentFee.findOne({ _id: feeId, studentId });

    if (!fee) {
      return res.status(404).json({ error: 'Fee assignment not found' });
    }

    if (fee.paidAmount > 0) {
      return res.status(400).json({ error: 'Cannot delete a fee that has already been partially or fully paid' });
    }

    await StudentFee.findByIdAndDelete(feeId);

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
      baseFee, grandTotal, selectedFeeCategoryIds
    } = req.body;

    const student = await Student.findByIdAndUpdate(id, {
      studentName, fatherName, motherName, fatherPhone, motherPhone, address, currentClass, section,
      admissionNumber, gender, bloodGroup, aadhaarNumber, religion, community,
      nationality, email, rollNumber, academicYear, studentStatus,
      fatherOccupation, motherOccupation, guardian, city, state, pincode, photoUrl,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      admissionDate: admissionDate ? new Date(admissionDate) : null,
      baseFee: baseFee ? parseFloat(baseFee) : null,
      grandTotal: grandTotal ? parseFloat(grandTotal) : null,
    }, { new: true });

    // Sync the student's fees using selectedFeeCategoryIds
    if (Array.isArray(selectedFeeCategoryIds)) {
      let defaultFees = {};
      const classDoc = await Class.findOne({ name: currentClass });
      if (classDoc) {
        if (section) {
          const sectionDoc = await Section.findOne({ name: section, classId: classDoc._id });
          if (sectionDoc && sectionDoc.defaultFees && Object.keys(sectionDoc.defaultFees).length > 0) {
            defaultFees = sectionDoc.defaultFees;
          } else if (classDoc.defaultFees) {
            defaultFees = classDoc.defaultFees;
          }
        } else if (classDoc.defaultFees) {
          defaultFees = classDoc.defaultFees;
        }
      }

      const existingStudentFees = await StudentFee.find({ studentId: id });
      const existingFeeMap = new Map(existingStudentFees.map(f => [f.feeCategoryId.toString(), f]));

      const assignedCatIds = new Set(selectedFeeCategoryIds);

      // Process selected categories
      for (const catId of selectedFeeCategoryIds) {
        const cat = await FeeCategory.findById(catId);
        let newAmount = 0;
        let uniformDetailsToSave = undefined;

        if (cat && cat.name.toLowerCase() === 'uniform') {
          const pricing = defaultFees[catId]?.pricing || {};
          const topPrice = parseFloat(pricing.topPerMetre || 0);
          const bottomPrice = parseFloat(pricing.bottomPerMetre || 0);
          const topLen = parseFloat(req.body.uniformDetails?.topLength || 0);
          const bottomLen = parseFloat(req.body.uniformDetails?.bottomLength || 0);
          newAmount = (topLen * topPrice) + (bottomLen * bottomPrice);
          uniformDetailsToSave = {
            topLength: topLen,
            bottomLength: bottomLen
          };
        } else {
          const feeConfig = defaultFees[catId];
          newAmount = typeof feeConfig === 'number' ? feeConfig : parseFloat(feeConfig?.amount || 0);
        }

        const existing = existingFeeMap.get(catId);

        if (existing) {
          existing.totalAmount = newAmount;
          existing.remainingAmount = Math.max(0, newAmount - existing.paidAmount);
          if (uniformDetailsToSave) {
            existing.uniformDetails = uniformDetailsToSave;
          }
          await existing.save();
        } else {
          await StudentFee.create({
            studentId: id,
            feeCategoryId: catId,
            totalAmount: newAmount,
            remainingAmount: newAmount,
            paidAmount: 0,
            uniformDetails: uniformDetailsToSave
          });
        }
      }

      // Remove unselected categories if paidAmount is 0
      for (const existing of existingStudentFees) {
        const catIdStr = existing.feeCategoryId.toString();
        if (!assignedCatIds.has(catIdStr)) {
          if (existing.paidAmount === 0) {
            await StudentFee.findByIdAndDelete(existing._id);
          }
        }
      }
    }

    if (req.user) {
      await ActivityLog.create({
        userId: req.user.id,
        action: 'UPDATED_STUDENT',
        details: `Updated full details and synchronized fees for student ${id}`
      });
    }

    res.json(student);
  } catch (error) {
    console.error("Update student error:", error);
    res.status(500).json({ error: 'Error updating student details' });
  }
};

export const promoteStudents = async (req, res) => {
  try {
    const { fromAcademicYear, toAcademicYear, classMapping } = req.body;

    if (!fromAcademicYear || !toAcademicYear || !classMapping) {
      return res.status(400).json({ error: 'fromAcademicYear, toAcademicYear, and classMapping are required.' });
    }

    const students = await Student.find({
      academicYear: fromAcademicYear,
      $or: [
        { studentStatus: 'Active' },
        { studentStatus: { $exists: false } },
        { studentStatus: null }
      ]
    });

    let promotedCount = 0;
    let graduatedCount = 0;

    for (const student of students) {
      const nextClass = classMapping[student.currentClass];
      
      if (nextClass) {
        if (nextClass === 'Graduated') {
          student.studentStatus = 'Graduated';
          graduatedCount++;
        } else {
          student.currentClass = nextClass;
          student.academicYear = toAcademicYear;
          promotedCount++;
        }
        await student.save();
      }
    }

    if (req.user) {
      await ActivityLog.create({
        userId: req.user.id,
        action: 'PROMOTED_STUDENTS',
        details: `Promoted ${promotedCount} students and graduated ${graduatedCount} from ${fromAcademicYear} to ${toAcademicYear}`
      });
    }

    res.json({ message: `Successfully promoted ${promotedCount} students and graduated ${graduatedCount} students.`, promotedCount, graduatedCount });

  } catch (error) {
    console.error('Error promoting students:', error);
    res.status(500).json({ error: 'Failed to promote students' });
  }
};
