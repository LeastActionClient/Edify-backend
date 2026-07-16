import mongoose from 'mongoose';
import xlsx from 'xlsx';
import {
  Application,
  Student,
  ActivityLog,
  StudentFee,
  StudentIncludedCharge,
  StudentActivity,
  Payment,
  Invoice,
  FeeCategory,
  Class,
  Section,
  IncludedCharge,
  IncludedChargeStockTransaction,
  Activity
} from '../models/index.js';
import { createStudentWithGeneratedAdmissionNumber } from '../services/studentAdmissionService.js';
import { isDuplicateAdmissionNumberError } from '../services/admissionNumberService.js';

export const assignClassDefaultFeesToStudent = async (student, session = null) => {
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

      const isUniform = cat.name.toLowerCase() === 'uniform';
      const isMandatory = cat.mandatory;

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
          const existing = await StudentFee.findOne({ studentId, feeCategoryId: catId }).session(session);
          if (!existing) {
            const uniformFeePayload = {
              studentId,
              feeCategoryId: catId,
              totalAmount: amount,
              remainingAmount: amount,
              paidAmount: 0,
              uniformDetails: uniformDetailsToSave
            };
            if (session) {
              await StudentFee.create([uniformFeePayload], { session });
            } else {
              await StudentFee.create(uniformFeePayload);
            }
          }
        } else if (amount > 0) {
          baseFeeTotal += amount;
          const existing = await StudentFee.findOne({ studentId, feeCategoryId: catId }).session(session);
          if (existing) {
            existing.totalAmount = amount;
            existing.remainingAmount = Math.max(0, amount - existing.paidAmount);
            await existing.save(session ? { session } : undefined);
          } else {
            const feePayload = {
              studentId,
              feeCategoryId: catId,
              totalAmount: amount,
              remainingAmount: amount,
              paidAmount: 0
            };
            if (session) {
              await StudentFee.create([feePayload], { session });
            } else {
              await StudentFee.create(feePayload);
            }
          }
        }
      }
    }

    // Update student's baseFee and grandTotal
    await Student.findByIdAndUpdate(studentId, {
      baseFee: baseFeeTotal,
      grandTotal: baseFeeTotal
    }, session ? { session } : undefined);

    return baseFeeTotal;
  } catch (error) {
    console.error("Error assigning class default fees to student", error);
    return 0;
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

    const result = students.map(s => {
      const allFees = feeMap[s._id.toString()] || [];
      const currentClassFees = allFees.filter(f =>
        f.className === s.currentClass || (!f.className && !f.academicYear)
      );
      const previousClassFees = allFees.filter(f =>
        f.className && f.className !== s.currentClass
      );

      return {
        ...s,
        studentFees: allFees,
        currentClassFees,
        previousClassFees
      };
    });

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

    const currentClassFees = studentFees.filter(f =>
      f.className === student.currentClass || (!f.className && !f.academicYear)
    );
    const previousClassFees = studentFees.filter(f =>
      f.className && f.className !== student.currentClass
    );

    const payments = await Payment.find({ studentId: id })
      .sort({ paymentDate: -1 })
      .lean();

    const includedCharges = await StudentIncludedCharge.find({ studentId: id })
      .populate('includedChargeId')
      .lean();

    const activities = await StudentActivity.find({ studentId: id })
      .populate('activityId')
      .lean();

    res.json({ ...student, studentFees, currentClassFees, previousClassFees, payments, includedCharges, activities });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching student details' });
  }
};



const clampNonNegative = (value) => Math.max(0, Number(value) || 0);

const recordIncludedChargeStock = async ({
  includedChargeId,
  type,
  quantity,
  previousStock,
  newStock,
  reason,
  referenceType,
  referenceId,
  performedById
}) => {
  await IncludedChargeStockTransaction.create({
    includedChargeId,
    type,
    quantity,
    previousStock,
    newStock,
    reason,
    referenceType,
    referenceId,
    performedById
  }, meta.session ? { session: meta.session } : undefined);
};

const adjustIncludedChargeStock = async (chargeId, delta, meta = {}) => {
  const charge = await IncludedCharge.findById(chargeId);
  if (!charge) return null;

  const previousStock = clampNonNegative(charge.stockQuantity);
  const nextStock = previousStock + delta;
  if (nextStock < 0) {
    throw new Error(`Not enough stock for included charge ${charge.name}`);
  }

  charge.stockQuantity = nextStock;
  await charge.save(meta.session ? { session: meta.session } : undefined);

  await recordIncludedChargeStock({
    includedChargeId: charge._id,
    type: delta >= 0 ? 'RETURN' : 'OUT',
    quantity: Math.abs(delta),
    previousStock,
    newStock: nextStock,
    performedById: meta.performedById,
    reason: meta.reason,
    referenceType: meta.referenceType,
    referenceId: meta.referenceId
  });

  return charge;
};

const getClassDefaultFees = async (currentClass, section) => {
  let defaultFees = {};
  const classDoc = await Class.findOne({ name: currentClass });

  if (!classDoc) {
    return defaultFees;
  }

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

  return defaultFees;
};

export const addStudentManually = async (req, res) => {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const { 
        studentName, fatherName, motherName, fatherPhone, motherPhone, address, 
        currentClass, section,
        dateOfBirth, gender, bloodGroup, aadhaarNumber, religion, community, caste, RTE, nationality,
        fatherOccupation, motherOccupation, guardian, city, state, pincode, whatsappNumber, emisNumber,
        applicationId, includedChargesIds = [], activitiesIds = []
      } = req.body;

      if (!studentName || !currentClass) {
        await session.abortTransaction();
        res.status(400).json({ error: 'Student Name and Class are required' });
        return;
      }

      let application = null;
      if (applicationId) {
        application = await Application.findById(applicationId).session(session);
        if (!application) {
          throw new Error('Application not found');
        }
        if (application.status === 'APPROVED') {
          throw new Error('This application has already been approved and linked to a student.');
        }
        const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalize(application.applyingClass) !== normalize(currentClass)) {
          throw new Error('Application class does not match selected class.');
        }
      }

      const studentPayload = {
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
        RTE: RTE || '',
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
        addedById: req.user?.id,
        applicationId: applicationId || null
      };

      const { student, admissionNumber } = await createStudentWithGeneratedAdmissionNumber(studentPayload, { session });

      const selectedIncludedChargeIds = [...new Set(includedChargesIds.map(id => id?.toString()).filter(Boolean))];
      const selectedActivityIds = [...new Set(activitiesIds.map(id => id?.toString()).filter(Boolean))];

      if (selectedIncludedChargeIds.length > 0) {
        const charges = await IncludedCharge.find({ _id: { $in: selectedIncludedChargeIds } }).session(session);
        const chargeMap = new Map(charges.map(charge => [charge._id.toString(), charge]));

        for (const chargeId of selectedIncludedChargeIds) {
          const charge = chargeMap.get(chargeId);
          if (!charge) {
            throw new Error('One of the included charges was not found');
          }
          if (clampNonNegative(charge.stockQuantity) <= 0) {
            throw new Error(`Not enough stock for ${charge.name}`);
          }
        }

        await StudentIncludedCharge.insertMany(
          selectedIncludedChargeIds.map(chargeId => ({
            studentId: student._id,
            includedChargeId: chargeId
          })),
          { session }
        );

        for (const chargeId of selectedIncludedChargeIds) {
          await adjustIncludedChargeStock(chargeId, -1, {
            session,
            performedById: req.user?.id,
            reason: `Assigned to student ${admissionNumber}`,
            referenceType: 'Student',
            referenceId: student._id
          });
        }
      }

      if (selectedActivityIds.length > 0) {
        const activities = await Activity.find({ _id: { $in: selectedActivityIds } }).session(session);
        const activityIdsFound = new Set(activities.map(activity => activity._id.toString()));
        const missingActivityId = selectedActivityIds.find(activityId => !activityIdsFound.has(activityId));
        if (missingActivityId) {
          throw new Error('One of the activities was not found');
        }

        await StudentActivity.insertMany(
          selectedActivityIds.map(activityId => ({
            studentId: student._id,
            activityId
          })),
          { session }
        );
      }

      const baseFeeTotal = await assignClassDefaultFeesToStudent(student, session);
      const selectedIncludedCharges = selectedIncludedChargeIds.length > 0
        ? await IncludedCharge.find({ _id: { $in: selectedIncludedChargeIds } }).session(session)
        : [];
      const selectedActivities = selectedActivityIds.length > 0
        ? await Activity.find({ _id: { $in: selectedActivityIds } }).session(session)
        : [];
      const includedChargesTotal = selectedIncludedCharges.reduce((sum, charge) => sum + (Number(charge.amount) || 0), 0);
      const activitiesTotal = selectedActivities.reduce((sum, activity) => sum + (Number(activity.amount) || 0), 0);

      await Student.findByIdAndUpdate(student._id, {
        includedChargesTotal,
        activitiesTotal,
        grandTotal: baseFeeTotal + includedChargesTotal + activitiesTotal
      }, { session });

      if (application) {
        application.status = 'APPROVED';
        application.approvedBy = req.user?.id;
        application.approvedAt = new Date();
        application.adminNo = admissionNumber;
        application.student = student._id;
        await application.save({ session });
      }

      if (req.user) {
        await ActivityLog.create([{
          userId: req.user.id,
          action: applicationId ? 'APPROVED_APPLICATION' : 'CREATED_STUDENT_MANUALLY',
          details: applicationId 
            ? `Application ${application.applicationId} approved. Student ${admissionNumber} created.`
            : `Student ${admissionNumber} created manually for class ${currentClass}`
        }], { session });
      }

      await session.commitTransaction();

      res.status(201).json({
        success: true,
        message: 'Student created successfully',
        admissionNumber,
        data: student
      });
      return;
    } catch (error) {
      await session.abortTransaction();
      if (isDuplicateAdmissionNumberError(error) && attempt < maxAttempts) {
        continue;
      }
      console.error("Manual add error:", error);
      res.status(500).json({ error: error.message || 'Error adding student manually' });
      return;
    } finally {
      session.endSession();
    }
  }
};

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

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const studentName = row['Student Name'] || row['Name'] || row['studentName'];

      if (!studentName) {
        errors.push(`Row ${i + 2}: Student Name is missing.`);
        continue;
      }

      try {
        let studentRecord = null;

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const result = await createStudentWithGeneratedAdmissionNumber({
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
              RTE: String(row['RTE'] || row['RTE'] || ''),
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
            studentRecord = result.student;
            break;
          } catch (err) {
            if (isDuplicateAdmissionNumberError(err) && attempt < 3) {
              continue;
            }
            throw err;
          }
        }

        if (!studentRecord) {
          errors.push(`Row ${i + 2}: Unable to generate a unique admission number.`);
          continue;
        }

        await assignClassDefaultFeesToStudent(studentRecord);
        successCount++;
      } catch (err) {
        if (err.code === 11000) {
          errors.push(`Row ${i + 2}: Admission number collision while importing student.`);
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

    const includedAssignments = await StudentIncludedCharge.find({ studentId: id });
    for (const assignment of includedAssignments) {
      await adjustIncludedChargeStock(assignment.includedChargeId, 1, {
        performedById: req.user?.id,
        reason: `Student ${id} deleted`,
        referenceType: 'Student',
        referenceId: id
      });
    }

    await Invoice.deleteMany({ studentId: id });
    await Payment.deleteMany({ studentId: id });
    await StudentFee.deleteMany({ studentId: id });
    await StudentIncludedCharge.deleteMany({ studentId: id });
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
      studentName,
      fatherName,
      motherName,
      fatherPhone,
      motherPhone,
      address,
      currentClass,
      section,
      dateOfBirth,
      gender,
      bloodGroup,
      aadhaarNumber,
      religion,
      community,
      nationality,
      email,
      rollNumber,
      admissionDate,
      academicYear,
      studentStatus,
      fatherOccupation,
      motherOccupation,
      guardian,
      city,
      state,
      pincode,
      photoUrl,
      RTE,
      isRTE,
      baseFee,
      includedChargesTotal,
      activitiesTotal,
      grandTotal,
      includedChargesIds,
      activitiesIds
    } = req.body;

    const currentStudent = await Student.findById(id);
    if (!currentStudent) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const resolvedRTE = typeof isRTE === 'boolean'
      ? (isRTE ? 'RTE' : 'General')
      : (RTE || '');

    const normalizeNumber = (value, fallback = 0) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const currentClassName = currentClass || currentStudent.currentClass;
    const currentAcademicYear = academicYear || currentStudent.academicYear;

    if (Array.isArray(includedChargesIds)) {
      const nextIncludedChargeIds = [...new Set(includedChargesIds.map(value => value?.toString()).filter(Boolean))];
      const previousAssignments = await StudentIncludedCharge.find({ studentId: id });
      const previousIncludedChargeIds = previousAssignments
        .map(item => item.includedChargeId?.toString())
        .filter(Boolean);
      const previousSet = new Set(previousIncludedChargeIds);
      const nextSet = new Set(nextIncludedChargeIds);
      const removedChargeIds = previousIncludedChargeIds.filter(chargeId => !nextSet.has(chargeId));
      const addedChargeIds = nextIncludedChargeIds.filter(chargeId => !previousSet.has(chargeId));

      if (addedChargeIds.length > 0) {
        const chargeDocs = await IncludedCharge.find({ _id: { $in: addedChargeIds } });
        const chargeMap = new Map(chargeDocs.map(charge => [charge._id.toString(), charge]));
        for (const chargeId of addedChargeIds) {
          const charge = chargeMap.get(chargeId);
          if (!charge) {
            return res.status(404).json({ error: 'One of the included charges was not found' });
          }
          if (clampNonNegative(charge.stockQuantity) <= 0) {
            return res.status(400).json({ error: `Not enough stock for ${charge.name}` });
          }
        }
      }

      await StudentIncludedCharge.deleteMany({ studentId: id });
      if (nextIncludedChargeIds.length > 0) {
        await StudentIncludedCharge.insertMany(
          nextIncludedChargeIds.map(chargeId => ({
            studentId: id,
            includedChargeId: chargeId
          }))
        );
      }

      for (const chargeId of removedChargeIds) {
        await adjustIncludedChargeStock(chargeId, 1, {
          performedById: req.user?.id,
          reason: `Removed from student ${currentStudent?.admissionNumber || id}`,
          referenceType: 'Student',
          referenceId: currentStudent?._id || id
        });
      }

      for (const chargeId of addedChargeIds) {
        await adjustIncludedChargeStock(chargeId, -1, {
          performedById: req.user?.id,
          reason: `Assigned to student ${currentStudent?.admissionNumber || id}`,
          referenceType: 'Student',
          referenceId: currentStudent?._id || id
        });
      }
    }

    if (Array.isArray(activitiesIds)) {
      const nextActivityIds = [...new Set(activitiesIds.map(value => value?.toString()).filter(Boolean))];
      const activityDocs = nextActivityIds.length > 0
        ? await Activity.find({ _id: { $in: nextActivityIds } })
        : [];
      const activitySet = new Set(activityDocs.map(activity => activity._id.toString()));
      const missingActivityId = nextActivityIds.find(activityId => !activitySet.has(activityId));
      if (missingActivityId) {
        return res.status(404).json({ error: 'One of the activities was not found' });
      }

      await StudentActivity.deleteMany({ studentId: id });
      if (nextActivityIds.length > 0) {
        await StudentActivity.insertMany(
          nextActivityIds.map(activityId => ({
            studentId: id,
            activityId
          }))
        );
      }
    }

    const syncSpecialFee = async (feeName, amount) => {
      const effectiveAmount = normalizeNumber(amount, 0);
      let category = await FeeCategory.findOne({ name: feeName });
      if (!category) {
        category = await FeeCategory.create({
          name: feeName,
          amount: 0,
          description: `System generated ${feeName}`
        });
      }

      const existingFee = await StudentFee.findOne({
        studentId: id,
        feeCategoryId: category._id,
        $or: [
          { className: currentClassName },
          { className: { $exists: false } },
          { className: null }
        ]
      });

      if (effectiveAmount <= 0) {
        if (existingFee && existingFee.paidAmount === 0) {
          await StudentFee.findByIdAndDelete(existingFee._id);
        }
        return;
      }

      if (existingFee) {
        existingFee.totalAmount = effectiveAmount;
        existingFee.remainingAmount = Math.max(0, effectiveAmount - (existingFee.paidAmount || 0));
        existingFee.className = currentClassName;
        existingFee.academicYear = currentAcademicYear;
        await existingFee.save();
      } else {
        await StudentFee.create({
          studentId: id,
          feeCategoryId: category._id,
          totalAmount: effectiveAmount,
          remainingAmount: effectiveAmount,
          className: currentClassName,
          academicYear: currentAcademicYear
        });
      }
    };

    await syncSpecialFee('Included Charges', includedChargesTotal);
    await syncSpecialFee('Activities', activitiesTotal);

    const resolvedBaseFee = normalizeNumber(baseFee, currentStudent.baseFee || 0);
    const resolvedIncludedChargesTotal = normalizeNumber(includedChargesTotal, currentStudent.includedChargesTotal || 0);
    const resolvedActivitiesTotal = normalizeNumber(activitiesTotal, currentStudent.activitiesTotal || 0);
    const resolvedGrandTotal = normalizeNumber(grandTotal, resolvedBaseFee + resolvedIncludedChargesTotal + resolvedActivitiesTotal);

    const student = await Student.findByIdAndUpdate(id, {
      studentName,
      fatherName,
      motherName,
      fatherPhone,
      motherPhone,
      address,
      currentClass: currentClassName,
      section,
      gender,
      bloodGroup,
      aadhaarNumber,
      religion,
      community,
      nationality,
      email,
      rollNumber,
      academicYear: currentAcademicYear,
      studentStatus,
      fatherOccupation,
      motherOccupation,
      guardian,
      city,
      state,
      pincode,
      photoUrl,
      RTE: resolvedRTE,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      admissionDate: admissionDate ? new Date(admissionDate) : null,
      baseFee: resolvedBaseFee,
      includedChargesTotal: resolvedIncludedChargesTotal,
      activitiesTotal: resolvedActivitiesTotal,
      grandTotal: resolvedGrandTotal
    }, { new: true });

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
      $or: [
        { academicYear: fromAcademicYear },
        { academicYear: { $exists: false } },
        { academicYear: null },
        { academicYear: '' }
      ],
      $and: [
        {
          $or: [
            { studentStatus: 'Active' },
            { studentStatus: { $exists: false } },
            { studentStatus: null }
          ]
        }
      ]
    });

    let promotedCount = 0;
    let graduatedCount = 0;

    for (const student of students) {
      const nextClass = classMapping[student.currentClass];
      
      if (nextClass) {
        if (nextClass === 'Graduated') {
          student.studentStatus = 'Graduated';
          await student.save();
          graduatedCount++;
          continue;
        }

        const oldClassName = student.currentClass;
        const oldAcademicYear = student.academicYear || fromAcademicYear;

        // 1. Tag existing unpaid fees as legacy (belonging to old class/year)
        await StudentFee.updateMany(
          { studentId: student._id, remainingAmount: { $gt: 0 } },
          {
            $set: {
              className: oldClassName,
              academicYear: oldAcademicYear
            }
          }
        );

        // 2. Mark fully paid fees with old class info too (for record keeping)
        await StudentFee.updateMany(
          { studentId: student._id, remainingAmount: { $eq: 0 }, className: { $exists: false } },
          {
            $set: {
              className: oldClassName,
              academicYear: oldAcademicYear
            }
          }
        );

        // 3. Update student to new class
        student.currentClass = nextClass;
        student.academicYear = toAcademicYear;
        await student.save();

        promotedCount++;
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
