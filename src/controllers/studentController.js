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
  Activity,
  StockHistory,
  AcademicYear,
  StudentEnrollment,
  StudentFeeConcession
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

    // Get all mandatory fee categories
    const categories = await FeeCategory.find();
    const validCatMap = new Map(categories.map(c => [c._id.toString(), c]));

    let baseFeeTotal = 0;

    // For this student, we assign ONLY mandatory categories (Base Fee) automatically
    for (const catId of Object.keys(defaultFees)) {
      const cat = validCatMap.get(catId);
      if (!cat) continue;

      const isMandatory = cat.mandatory;

      if (isMandatory) {
        const feeConfig = defaultFees[catId];
        const amount = typeof feeConfig === 'number' ? feeConfig : parseFloat(feeConfig?.amount || 0);

        if (amount > 0) {
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

    const concessions = await StudentFeeConcession.find({
      studentId: { $in: studentIds },
      status: { $in: ['Active', 'Inactive'] }
    }).lean();

    const concessionMap = new Map();
    concessions.forEach(c => {
      concessionMap.set(c.studentFeeId.toString(), c);
    });

    const feeMap = {};
    studentFees.forEach(fee => {
      const concession = concessionMap.get(fee._id.toString());
      fee.feeCategory = fee.feeCategoryId; // Map populated field for frontend
      
      if (concession) {
        fee.lessAmount = concession.lessAmount;
        fee.concessionStatus = concession.status; // 'Active' or 'Inactive'
        if (concession.status === 'Active') {
          fee.remainingAmount = Math.max(0, fee.totalAmount - concession.lessAmount - (fee.paidAmount || 0));
        } else {
          fee.remainingAmount = Math.max(0, fee.totalAmount - (fee.paidAmount || 0));
        }
      } else {
        fee.lessAmount = 0;
        fee.concessionStatus = 'None';
      }
      
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
      .populate('feeCategoryId');

    for (const f of studentFeesRaw) {
      if ((f.totalAmount === 0 || f.remainingAmount === 0) && (f.paidAmount || 0) === 0 && f.feeCategoryId) {
        const cat = f.feeCategoryId;
        let healedAmt = parseFloat(cat.amount || 0);
        if (cat.name.toLowerCase() === 'uniform' && cat.pricing) {
          const topPrice = parseFloat(cat.pricing.topPerMetre || 0);
          const bottomPrice = parseFloat(cat.pricing.bottomPerMetre || 0);
          const topLen = parseFloat(f.uniformDetails?.topLength || 0);
          const bottomLen = parseFloat(f.uniformDetails?.bottomLength || 0);
          healedAmt = (topLen * topPrice) + (bottomLen * bottomPrice);
        }
        if (healedAmt <= 0) {
          const classDoc = await Class.findOne({ name: f.className || student.currentClass }).lean();
          let sectionDoc = null;
          if (classDoc && student.section) {
            sectionDoc = await Section.findOne({ name: student.section, classId: classDoc._id }).lean();
          }
          const mergedDefaultFees = { ...(classDoc?.defaultFees || {}), ...(sectionDoc?.defaultFees || {}) };
          const feeConfig = mergedDefaultFees[cat._id.toString()];

          if (typeof feeConfig === 'number' && feeConfig > 0) {
            healedAmt = feeConfig;
          } else if (feeConfig && typeof feeConfig === 'object') {
            healedAmt = parseFloat(feeConfig.amount) || 0;
            if (cat.name.toLowerCase() === 'uniform' && feeConfig.pricing) {
              const topPrice = parseFloat(feeConfig.pricing.topPerMetre || 0);
              const bottomPrice = parseFloat(feeConfig.pricing.bottomPerMetre || 0);
              healedAmt = topPrice + bottomPrice;
            }
          }
        }
        if (healedAmt > 0) {
          f.totalAmount = healedAmt;
          f.remainingAmount = healedAmt;
          await StudentFee.updateOne(
            { _id: f._id },
            { $set: { totalAmount: healedAmt, remainingAmount: healedAmt } }
          );
        }
      }
    }

    const concessions = await StudentFeeConcession.find({
      studentId: id,
      status: { $in: ['Active', 'Inactive'] }
    }).lean();

    const concessionMap = new Map();
    concessions.forEach(c => {
      concessionMap.set(c.studentFeeId.toString(), c);
    });

    const studentFees = studentFeesRaw.map(fee => {
      const fObj = fee.toObject ? fee.toObject() : fee;
      const concession = concessionMap.get(fObj._id.toString());
      fObj.feeCategory = fObj.feeCategoryId;
      
      if (concession) {
        fObj.lessAmount = concession.lessAmount;
        fObj.concessionStatus = concession.status; // 'Active' or 'Inactive'
        if (concession.status === 'Active') {
          fObj.remainingAmount = Math.max(0, fObj.totalAmount - concession.lessAmount - (fObj.paidAmount || 0));
        } else {
          fObj.remainingAmount = Math.max(0, fObj.totalAmount - (fObj.paidAmount || 0));
        }
      } else {
        fObj.lessAmount = 0;
        fObj.concessionStatus = 'None';
      }
      return fObj;
    });

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
  performedById,
  session
}) => {
  const payload = {
    includedChargeId,
    type,
    quantity,
    previousStock,
    newStock,
    reason,
    referenceType,
    referenceId,
    performedById
  };

  if (session) {
    await IncludedChargeStockTransaction.create([payload], { session });
  } else {
    await IncludedChargeStockTransaction.create(payload);
  }
};

const adjustIncludedChargeStock = async (chargeId, delta, meta = {}) => {
  const charge = await IncludedCharge.findById(chargeId).session(meta.session || null);
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
    referenceId: meta.referenceId,
    session: meta.session
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

const validateStudentInput = (data) => {
  const {
    fatherName,
    motherName,
    guardianName,
    guardian,
    fatherPhone,
    motherPhone,
    whatsappNumber,
    fatherOccupation,
    motherOccupation,
    caste,
    emisNo,
    emisNumber
  } = data;

  // Father Name Validation (Optional)
  const fName = (fatherName || '').trim();
  if (fName) {
    if (!/^[a-zA-Z\s.]+$/.test(fName)) {
      return 'Father Name must contain only alphabets, spaces, and dots.';
    }
    if (fName.length < 3 || fName.length > 100) {
      return 'Father Name must be between 3 and 100 characters.';
    }
  }

  // Mother Name Validation (Optional)
  const mName = (motherName || '').trim();
  if (mName) {
    if (!/^[a-zA-Z\s.]+$/.test(mName)) {
      return 'Mother Name must contain only alphabets, spaces, and dots.';
    }
    if (mName.length < 3 || mName.length > 100) {
      return 'Mother Name must be between 3 and 100 characters.';
    }
  }

  // Guardian Name Validation (Optional)
  const gName = (guardianName || guardian || '').trim();
  if (gName) {
    if (!/^[a-zA-Z\s.]+$/.test(gName)) {
      return 'Guardian Name must contain only alphabets, spaces, and dots.';
    }
    if (gName.length < 3 || gName.length > 100) {
      return 'Guardian Name must be between 3 and 100 characters.';
    }
  }

  // Father Phone Validation (Optional)
  const fPhone = (fatherPhone || '').trim();
  if (fPhone) {
    if (!/^[5-9]\d{9}$/.test(fPhone)) {
      return 'Father Phone must be exactly 10 digits and start with 5, 6, 7, 8, or 9.';
    }
  }

  // Mother Phone Validation (Optional)
  const mPhone = (motherPhone || '').trim();
  if (mPhone) {
    if (!/^[5-9]\d{9}$/.test(mPhone)) {
      return 'Mother Phone must be exactly 10 digits and start with 5, 6, 7, 8, or 9.';
    }
  }

  // WhatsApp Number Validation (Optional)
  const wPhone = (whatsappNumber || '').trim();
  if (wPhone) {
    if (!/^[5-9]\d{9}$/.test(wPhone)) {
      return 'WhatsApp Number must be exactly 10 digits and start with 5, 6, 7, 8, or 9.';
    }
  }

  // Father Occupation Validation (Optional)
  const fOcc = (fatherOccupation || '').trim();
  if (fOcc) {
    if (!/^[a-zA-Z\s]+$/.test(fOcc)) {
      return 'Father Occupation must contain only alphabets and spaces.';
    }
    if (fOcc.length > 100) {
      return 'Father Occupation must not exceed 100 characters.';
    }
  }

  // Mother Occupation Validation (Optional)
  const mOcc = (motherOccupation || '').trim();
  if (mOcc) {
    if (!/^[a-zA-Z\s]+$/.test(mOcc)) {
      return 'Mother Occupation must contain only alphabets and spaces.';
    }
    if (mOcc.length > 100) {
      return 'Mother Occupation must not exceed 100 characters.';
    }
  }

  // Caste Validation (Optional)
  const casteVal = (caste || '').trim();
  if (casteVal) {
    if (!/^[a-zA-Z\s]+$/.test(casteVal)) {
      return 'Caste must contain only alphabets and spaces.';
    }
    if (casteVal.length > 50) {
      return 'Caste must not exceed 50 characters.';
    }
  }

  // EMIS No Validation (Optional)
  const emisVal = (emisNo || emisNumber || '').trim();
  if (emisVal && !/^\d{10}$/.test(emisVal)) {
    return 'EMIS No must be exactly 10 digits.';
  }

  return null;
};

const validateAdmissionNumber = (admissionNumber) => {
  const admNum = (admissionNumber || '').trim();
  if (!admNum) {
    return 'Admission Number is required.';
  }
  if (admNum.length < 3 || admNum.length > 30) {
    return 'Admission Number must be between 3 and 30 characters.';
  }
  if (!/^[a-zA-Z0-9\-/]+$/.test(admNum)) {
    return 'Admission Number must contain only letters, numbers, hyphens (-), and forward slashes (/).';
  }
  return null;
};

export const addStudentManually = async (req, res) => {
  const {
    admissionNumber,
    studentName, fatherName, motherName, fatherPhone, motherPhone, address,
    currentClass, section,
    dateOfBirth, gender, bloodGroup, aadhaarNumber, religion, community, caste, RTE, nationality,
    fatherOccupation, motherOccupation, guardian, guardianName, city, state, pincode,
    whatsappNumber, emisNumber, emisNo,
    applicationId, includedChargesIds = [], activitiesIds = []
  } = req.body;

  if (!admissionNumber || !studentName || !currentClass) {
    res.status(400).json({ error: 'Admission Number, Student Name and Class are required' });
    return;
  }

  if (section && !/^[a-zA-Z]+$/.test(section.trim())) {
    res.status(400).json({ error: 'Section can contain only alphabetic characters.' });
    return;
  }

  const admErr = validateAdmissionNumber(admissionNumber);
  if (admErr) {
    res.status(400).json({ error: admErr });
    return;
  }

  const existingStudent = await Student.findOne({ 
    admissionNumber: { $regex: new RegExp(`^${admissionNumber.trim()}$`, 'i') } 
  });
  if (existingStudent) {
    res.status(400).json({ error: 'Admission Number already exists. Please enter another Admission Number.' });
    return;
  }

  const valError = validateStudentInput({
    fatherName,
    motherName,
    fatherPhone,
    motherPhone,
    fatherOccupation,
    motherOccupation,
    guardianName,
    guardian,
    whatsappNumber,
    caste,
    emisNo,
    emisNumber
  });
  if (valError) {
    res.status(400).json({ error: valError });
    return;
  }

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const activeYear = await AcademicYear.findOne({ status: 'Active' }).session(session);
    if (!activeYear) {
      throw new Error('No active academic year found in the system. Please create and activate an academic year first.');
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
      admissionNumber: admissionNumber.trim(),
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
      caste: (caste || '').trim(),
      RTE: RTE || '',
      nationality: nationality || '',
      fatherOccupation: fatherOccupation || '',
      motherOccupation: motherOccupation || '',
      guardian: (guardianName || guardian || '').trim(),
      guardianName: (guardianName || guardian || '').trim(),
      city: city || '',
      state: state || '',
      pincode: pincode || '',
      whatsappNumber: (whatsappNumber || '').trim(),
      emisNumber: (emisNo || emisNumber || '').trim(),
      emisNo: (emisNo || emisNumber || '').trim(),
      currentClass,
      section,
      addedById: req.user?.id,
      applicationId: applicationId || undefined,
      academicYear: activeYear.year
    };

    const createdStudents = await Student.create([studentPayload], { session });
    const student = createdStudents[0];

    await StudentEnrollment.create([{
      studentId: student._id,
      academicYearId: activeYear._id,
      academicYear: activeYear.year,
      className: currentClass,
      sectionName: section || '',
      status: 'Active',
      joinedDate: new Date()
    }], { session });

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
    console.error("Manual add error:", error);
    res.status(500).json({ error: error.message || 'Error adding student manually' });
    return;
  } finally {
    session.endSession();
  }
};

const parseExcelDate = (val) => {
  if (!val) return null;
  
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate()));
  }

  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    return null;
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;

    let match = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      return new Date(Date.UTC(year, month, day));
    }

    match = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (match) {
      const p1 = parseInt(match[1], 10);
      const p2 = parseInt(match[2], 10);
      const year = parseInt(match[3], 10);
      let day, month;
      if (p1 > 12) {
        day = p1;
        month = p2 - 1;
      } else if (p2 > 12) {
        day = p2;
        month = p1 - 1;
      } else {
        day = p1;
        month = p2 - 1;
      }
      return new Date(Date.UTC(year, month, day));
    }

    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    }
  }
  return null;
};

export const bulkImportStudents = async (req, res) => {
  try {
    const { currentClass, section } = req.body;

    if (section && !/^[a-zA-Z]+$/.test(section.trim())) {
      res.status(400).json({ error: 'Section can contain only alphabetic characters.' });
      return;
    }

    const activeYear = await AcademicYear.findOne({ status: 'Active' });
    if (!activeYear) {
      res.status(400).json({ error: 'No active academic year found. Please create and activate an academic year first.' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No Excel file provided' });
      return;
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rawData = xlsx.utils.sheet_to_json(sheet);

    if (rawData.length === 0) {
      res.status(400).json({ error: 'Excel file is empty' });
      return;
    }

    let successCount = 0;
    let duplicateCount = 0;
    let validationErrorsCount = 0;
    let dbErrorsCount = 0;
    const errors = [];

    const batchAdmissionNumbers = new Set();

    for (let i = 0; i < rawData.length; i++) {
      const rawRow = rawData[i];
      // Normalize headers (case-insensitive and trim)
      const row = {};
      for (const key of Object.keys(rawRow)) {
        if (key) {
          const normalizedKey = String(key).trim().toLowerCase();
          row[normalizedKey] = rawRow[key];
        }
      }

      // Read exact Admission Number
      const admissionNumber = String(row['admission number'] || row['admission no'] || '').trim();
      
      if (!admissionNumber) {
        errors.push(`Row ${i + 2}: Admission Number is missing.`);
        validationErrorsCount++;
        continue;
      }

      const admErr = validateAdmissionNumber(admissionNumber);
      if (admErr) {
        errors.push(`Row ${i + 2}: ${admErr}`);
        validationErrorsCount++;
        continue;
      }

      if (batchAdmissionNumbers.has(admissionNumber.toLowerCase())) {
        errors.push(`Row ${i + 2}: Duplicate Admission Number "${admissionNumber}" inside Excel file.`);
        duplicateCount++;
        continue;
      }
      batchAdmissionNumbers.add(admissionNumber.toLowerCase());

      // Duplicate Check
      const existingStudent = await Student.findOne({ 
        admissionNumber: { $regex: new RegExp(`^${admissionNumber.trim()}$`, 'i') } 
      });
      if (existingStudent) {
        errors.push(`Row ${i + 2}: Duplicate Admission Number "${admissionNumber}" already exists in database.`);
        duplicateCount++;
        continue;
      }

      const casteVal = String(row['caste'] || '').trim();
      const emisNoVal = String(row['emis no'] || row['emis number'] || row['emis'] || '').trim();
      const guardianNameVal = String(row['guardian name'] || row['guardian'] || '').trim();
      const whatsappNumberVal = String(row['whatsapp number'] || row['whatsapp no'] || '').trim();

      const rowValError = validateStudentInput({
        fatherName: String(row['father name'] || ''),
        motherName: String(row['mother name'] || ''),
        fatherPhone: String(row['father phone'] || row['father mobile'] || row['parent mobile number'] || row['mobile number'] || ''),
        motherPhone: String(row['mother phone'] || row['mother mobile'] || ''),
        fatherOccupation: String(row['father occupation'] || ''),
        motherOccupation: String(row['mother occupation'] || ''),
        guardianName: guardianNameVal,
        guardian: guardianNameVal,
        whatsappNumber: whatsappNumberVal,
        caste: casteVal,
        emisNo: emisNoVal,
        emisNumber: emisNoVal
      });
      
      if (rowValError) {
        errors.push(`Row ${i + 2}: ${rowValError}`);
        validationErrorsCount++;
        continue;
      }

      try {
        const studentPayload = {
          admissionNumber,
          studentName,
          fatherName: String(row['father name'] || ''),
          motherName: String(row['mother name'] || ''),
          fatherPhone: String(row['father phone'] || row['father mobile'] || row['parent mobile number'] || row['mobile number'] || ''),
          motherPhone: String(row['mother phone'] || row['mother mobile'] || ''),
          address: String(row['address'] || ''),
          gender: String(row['gender'] || row['sex'] || ''),
          bloodGroup: String(row['blood group'] || ''),
          aadhaarNumber: String(row['aadhar no'] || row['aadhaar number'] || row['aadhar number'] || ''),
          religion: String(row['religion'] || ''),
          community: String(row['community'] || ''),
          caste: casteVal,
          RTE: String(row['rte'] || ''),
          nationality: String(row['nationality'] || ''),
          fatherOccupation: String(row['father occupation'] || ''),
          motherOccupation: String(row['mother occupation'] || ''),
          guardian: guardianNameVal,
          guardianName: guardianNameVal,
          city: String(row['city'] || ''),
          state: String(row['state'] || ''),
          pincode: String(row['pincode'] || row['pin code'] || row['pin'] || row['postal code'] || ''),
          dateOfBirth: parseExcelDate(row['date of birth'] || row['dob']),
          whatsappNumber: whatsappNumberVal,
          emisNumber: emisNoVal,
          emisNo: emisNoVal,
          email: String(row['email'] || ''),
          rollNumber: String(row['roll number'] || ''),
          admissionDate: parseExcelDate(row['admission date'] || row['date of admission']),
          studentStatus: String(row['student status'] || row['status'] || 'Active'),
          academicYear: activeYear.year,
          currentClass,
          section: section || null,
          addedById: req.user?.id
        };

        const studentRecord = await Student.create(studentPayload);

        await StudentEnrollment.create({
          studentId: studentRecord._id,
          academicYearId: activeYear._id,
          academicYear: activeYear.year,
          className: currentClass,
          sectionName: section || '',
          status: 'Active',
          joinedDate: new Date()
        });

        try {
          await assignClassDefaultFeesToStudent(studentRecord);
        } catch (feeError) {
          console.warn(`Fee assignment failed for student ${admissionNumber}:`, feeError);
        }
        
        successCount++;
      } catch (err) {
        if (err.code === 11000) {
          errors.push(`Row ${i + 2}: Duplicate Admission Number`);
          duplicateCount++;
        } else {
          errors.push(`Row ${i + 2}: Error saving to DB: ${err.message}`);
          dbErrorsCount++;
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
      message: 'Import Completed',
      successCount,
      duplicateCount,
      validationErrorsCount,
      dbErrorsCount,
      errors
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

    const assignedFees = await StudentFee.find({ studentId: id });
    for (const sf of assignedFees) {
      if (sf.feeCategoryId && sf.isStockDeducted) {
        const cat = await FeeCategory.findById(sf.feeCategoryId);
        if (cat && cat.isStockItem) {
          const prev = cat.currentStock || 0;
          cat.currentStock = prev + 1;
          await cat.save();
          await StockHistory.create({
            categoryId: cat._id,
            categoryName: cat.name,
            previousStock: prev,
            updatedStock: prev + 1,
            difference: 1,
            action: 'STUDENT_DELETION',
            referenceType: 'Student',
            referenceId: id,
            updatedBy: req.user?.id
          });
        }
      }
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

    if (fee.feeCategoryId && fee.isStockDeducted) {
      const cat = await FeeCategory.findById(fee.feeCategoryId);
      if (cat && cat.isStockItem) {
        const prev = cat.currentStock || 0;
        cat.currentStock = prev + 1;
        await cat.save();
        await StockHistory.create({
          categoryId: cat._id,
          categoryName: cat.name,
          previousStock: prev,
          updatedStock: prev + 1,
          difference: 1,
          action: 'STUDENT_REMOVAL',
          referenceType: 'Student',
          referenceId: studentId,
          updatedBy: req.user?.id
        });
      }
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
      admissionNumber,
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
      caste,
      nationality,
      email,
      rollNumber,
      admissionDate,
      academicYear,
      studentStatus,
      fatherOccupation,
      motherOccupation,
      guardian,
      guardianName,
      city,
      state,
      pincode,
      photoUrl,
      RTE,
      isRTE,
      whatsappNumber,
      emisNumber,
      emisNo,
      baseFee,
      includedChargesTotal,
      activitiesTotal,
      grandTotal,
      includedChargesIds,
      activitiesIds,
      selectedFeeCategoryIds,
      uniformDetails
    } = req.body;

    if (!admissionNumber) {
      return res.status(400).json({ error: 'Admission Number is required.' });
    }

    if (section && !/^[a-zA-Z]+$/.test(section.trim())) {
      return res.status(400).json({ error: 'Section can contain only alphabetic characters.' });
    }

    const admErr = validateAdmissionNumber(admissionNumber);
    if (admErr) {
      return res.status(400).json({ error: admErr });
    }

    const existingStudent = await Student.findOne({ 
      admissionNumber: { $regex: new RegExp(`^${admissionNumber.trim()}$`, 'i') },
      _id: { $ne: id }
    });
    if (existingStudent) {
      return res.status(400).json({ error: 'Admission Number already exists. Please enter another Admission Number.' });
    }

    const valError = validateStudentInput({
      fatherName,
      motherName,
      fatherPhone,
      motherPhone,
      fatherOccupation,
      motherOccupation,
      guardianName,
      guardian,
      whatsappNumber,
      caste,
      emisNo,
      emisNumber
    });
    if (valError) {
      return res.status(400).json({ error: valError });
    }

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

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (Array.isArray(selectedFeeCategoryIds)) {
        const getCatIdStr = (val) => {
          if (!val) return '';
          if (typeof val === 'string') return val;
          if (val._id) return val._id.toString();
          return val.toString();
        };

        const nextFeeCatIds = [...new Set(selectedFeeCategoryIds.map(value => getCatIdStr(value)).filter(Boolean))];

        const systemCats = await FeeCategory.find({ name: { $in: ['Included Charges', 'Activities', 'Base Fee', 'Full Fees'] } }).session(session);
        const systemCatIds = new Set(systemCats.map(c => c._id.toString()));

        const currentAssignedFees = await StudentFee.find({ studentId: id }).session(session);
        const previousFeeCatIds = currentAssignedFees
          .map(f => getCatIdStr(f.feeCategoryId))
          .filter(catId => catId && !systemCatIds.has(catId));

        const previousSet = new Set(previousFeeCatIds);
        const nextSet = new Set(nextFeeCatIds.filter(catId => !systemCatIds.has(catId)));

        const removedFeeCatIds = previousFeeCatIds.filter(catId => !nextSet.has(catId));

        // RULE 2: Validate removal of charges (Reject if paidAmount > 0 or payment exists)
        for (const catId of removedFeeCatIds) {
          const existingFeesForCat = currentAssignedFees.filter(f => getCatIdStr(f.feeCategoryId) === catId);
          for (const existingFee of existingFeesForCat) {
            const paymentExists = await Payment.findOne({
              $or: [
                { studentFeeId: existingFee._id },
                { 'feeAllocations.studentFeeId': existingFee._id }
              ]
            }).session(session);

            if ((existingFee.paidAmount || 0) > 0 || paymentExists) {
              const cat = await FeeCategory.findById(catId).session(session);
              const catName = cat ? cat.name : 'Fee';
              await session.abortTransaction();
              session.endSession();
              return res.status(400).json({
                error: `Cannot remove fee "${catName}" because payment history exists (Paid: ₹${existingFee.paidAmount || 0}).`
              });
            }

            await StudentFee.findByIdAndDelete(existingFee._id, { session });
          }
        }

        const defaultFees = await getClassDefaultFees(currentClassName, section);

        // Validate stock availability for newly added stock items
        const addedFeeCatIds = nextFeeCatIds.filter(catId => !previousSet.has(catId));
        if (addedFeeCatIds.length > 0) {
          for (const catId of addedFeeCatIds) {
            const cat = await FeeCategory.findById(catId).session(session);
            if (cat && cat.isStockItem) {
              if ((cat.currentStock || 0) <= 0) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ error: `Cannot assign ${cat.name}. It is currently out of stock.` });
              }
            }
          }
        }

        // Process assigned categories in nextSet (Create / Update / Deduplicate)
        for (const catId of Array.from(nextSet)) {
          const cat = await FeeCategory.findById(catId).session(session);
          if (!cat) continue;

          let amount = 0;
          let uniformDetailsToSave = undefined;

          if (cat.name.toLowerCase() === 'uniform') {
            const pricing = defaultFees[catId]?.pricing || cat.pricing || {};
            const topPrice = parseFloat(pricing.topPerMetre || 0);
            const bottomPrice = parseFloat(pricing.bottomPerMetre || 0);
            const topLen = parseFloat(uniformDetails?.topLength || 0);
            const bottomLen = parseFloat(uniformDetails?.bottomLength || 0);
            amount = (topLen * topPrice) + (bottomLen * bottomPrice);
            uniformDetailsToSave = { topLength: topLen, bottomLength: bottomLen };
          } else {
            const feeConfig = defaultFees[catId];
            if (typeof feeConfig === 'number') {
              amount = feeConfig;
            } else if (feeConfig && feeConfig.amount !== undefined && feeConfig.amount !== null && Number(feeConfig.amount) > 0) {
              amount = parseFloat(feeConfig.amount);
            } else {
              amount = parseFloat(cat.amount || 0);
            }
          }

          const existingFees = await StudentFee.find({ studentId: id, feeCategoryId: catId }).session(session);

          if (existingFees.length > 0) {
            const primaryFee = existingFees[0];
            // RULE 1: Never overwrite StudentFee when paidAmount > 0
            if ((primaryFee.paidAmount || 0) === 0) {
              if (amount > 0) {
                primaryFee.totalAmount = amount;
                primaryFee.remainingAmount = amount;
                primaryFee.className = currentClassName;
                primaryFee.academicYear = currentAcademicYear;
                if (uniformDetailsToSave) primaryFee.uniformDetails = uniformDetailsToSave;
                await primaryFee.save({ session });
              }
            }
            // Clean up extra duplicates if any exist
            if (existingFees.length > 1) {
              for (let dIdx = 1; dIdx < existingFees.length; dIdx++) {
                const dupFee = existingFees[dIdx];
                const dupPayment = await Payment.findOne({
                  $or: [{ studentFeeId: dupFee._id }, { 'feeAllocations.studentFeeId': dupFee._id }]
                }).session(session);

                if ((dupFee.paidAmount || 0) === 0 && !dupPayment) {
                  await StudentFee.findByIdAndDelete(dupFee._id, { session });
                }
              }
            }
          } else if (amount > 0) {
            await StudentFee.create([{
              studentId: id,
              feeCategoryId: catId,
              totalAmount: amount,
              remainingAmount: amount,
              paidAmount: 0,
              className: currentClassName,
              academicYear: currentAcademicYear,
              uniformDetails: uniformDetailsToSave
            }], { session });
          }
        }
      }

      if (Array.isArray(includedChargesIds)) {
        const nextIncludedChargeIds = [...new Set(includedChargesIds.map(value => value?.toString()).filter(Boolean))];
        const previousAssignments = await StudentIncludedCharge.find({ studentId: id }).session(session);
        const previousIncludedChargeIds = previousAssignments
          .map(item => item.includedChargeId?.toString())
          .filter(Boolean);
        const previousSet = new Set(previousIncludedChargeIds);
        const nextSet = new Set(nextIncludedChargeIds);
        const removedChargeIds = previousIncludedChargeIds.filter(chargeId => !nextSet.has(chargeId));
        const addedChargeIds = nextIncludedChargeIds.filter(chargeId => !previousSet.has(chargeId));

        if (addedChargeIds.length > 0) {
          const chargeDocs = await IncludedCharge.find({ _id: { $in: addedChargeIds } }).session(session);
          const chargeMap = new Map(chargeDocs.map(charge => [charge._id.toString(), charge]));
          for (const chargeId of addedChargeIds) {
            const charge = chargeMap.get(chargeId);
            if (!charge) {
              await session.abortTransaction();
              session.endSession();
              return res.status(404).json({ error: 'One of the included charges was not found' });
            }
            if (clampNonNegative(charge.stockQuantity) <= 0) {
              await session.abortTransaction();
              session.endSession();
              return res.status(400).json({ error: `Not enough stock for ${charge.name}` });
            }
          }
        }

        await StudentIncludedCharge.deleteMany({ studentId: id }, { session });
        if (nextIncludedChargeIds.length > 0) {
          await StudentIncludedCharge.insertMany(
            nextIncludedChargeIds.map(chargeId => ({
              studentId: id,
              includedChargeId: chargeId
            })),
            { session }
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
          ? await Activity.find({ _id: { $in: nextActivityIds } }).session(session)
          : [];
        const activitySet = new Set(activityDocs.map(activity => activity._id.toString()));
        const missingActivityId = nextActivityIds.find(activityId => !activitySet.has(activityId));
        if (missingActivityId) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({ error: 'One of the activities was not found' });
        }

        await StudentActivity.deleteMany({ studentId: id }, { session });
        if (nextActivityIds.length > 0) {
          await StudentActivity.insertMany(
            nextActivityIds.map(activityId => ({
              studentId: id,
              activityId
            })),
            { session }
          );
        }
      }

      const syncSpecialFee = async (feeName, amount) => {
        const effectiveAmount = normalizeNumber(amount, 0);
        let category = await FeeCategory.findOne({ name: feeName }).session(session);
        if (!category) {
          const newCats = await FeeCategory.create([{
            name: feeName,
            amount: 0,
            description: `System generated ${feeName}`
          }], { session });
          category = newCats[0];
        }

        const existingFee = await StudentFee.findOne({
          studentId: id,
          feeCategoryId: category._id,
          $or: [
            { className: currentClassName },
            { className: { $exists: false } },
            { className: null }
          ]
        }).session(session);

        if (effectiveAmount <= 0) {
          if (existingFee && (existingFee.paidAmount || 0) === 0) {
            const paymentExists = await Payment.findOne({
              $or: [{ studentFeeId: existingFee._id }, { 'feeAllocations.studentFeeId': existingFee._id }]
            }).session(session);

            if (!paymentExists) {
              await StudentFee.findByIdAndDelete(existingFee._id, { session });
            }
          }
          return;
        }

        if (existingFee) {
          // RULE 1: Do not overwrite if paidAmount > 0
          if ((existingFee.paidAmount || 0) === 0) {
            existingFee.totalAmount = effectiveAmount;
            existingFee.remainingAmount = effectiveAmount;
            existingFee.className = currentClassName;
            existingFee.academicYear = currentAcademicYear;
            await existingFee.save({ session });
          }
        } else {
          await StudentFee.create([{
            studentId: id,
            feeCategoryId: category._id,
            totalAmount: effectiveAmount,
            remainingAmount: effectiveAmount,
            paidAmount: 0,
            className: currentClassName,
            academicYear: currentAcademicYear
          }], { session });
        }
      };

      await syncSpecialFee('Included Charges', includedChargesTotal);
      await syncSpecialFee('Activities', activitiesTotal);

      const resolvedBaseFee = normalizeNumber(baseFee, currentStudent.baseFee || 0);
      const resolvedIncludedChargesTotal = normalizeNumber(includedChargesTotal, currentStudent.includedChargesTotal || 0);
      const resolvedActivitiesTotal = normalizeNumber(activitiesTotal, currentStudent.activitiesTotal || 0);

      const allFinalStudentFees = await StudentFee.find({ studentId: id }).session(session);
      const calculatedGrandTotal = allFinalStudentFees.reduce((sum, f) => sum + (f.totalAmount || 0), 0);
      const resolvedGrandTotal = calculatedGrandTotal > 0 ? calculatedGrandTotal : normalizeNumber(grandTotal, resolvedBaseFee + resolvedIncludedChargesTotal + resolvedActivitiesTotal);

      const student = await Student.findByIdAndUpdate(id, {
        admissionNumber: admissionNumber.trim(),
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
        caste: (caste !== undefined ? caste.trim() : currentStudent.caste) || '',
        nationality,
        email,
        rollNumber,
        academicYear: currentAcademicYear,
        studentStatus,
        fatherOccupation,
        motherOccupation,
        guardian: (guardianName !== undefined || guardian !== undefined ? (guardianName || guardian).trim() : currentStudent.guardian) || '',
        guardianName: (guardianName !== undefined || guardian !== undefined ? (guardianName || guardian).trim() : (currentStudent.guardianName || currentStudent.guardian)) || '',
        whatsappNumber: (whatsappNumber !== undefined ? whatsappNumber.trim() : currentStudent.whatsappNumber) || '',
        emisNumber: (emisNo !== undefined || emisNumber !== undefined ? (emisNo || emisNumber).trim() : currentStudent.emisNumber) || '',
        emisNo: (emisNo !== undefined || emisNumber !== undefined ? (emisNo || emisNumber).trim() : (currentStudent.emisNo || currentStudent.emisNumber)) || '',
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
      }, { new: true, session });

      if (student.currentClass && student.academicYear) {
        await StudentEnrollment.findOneAndUpdate(
          { studentId: id, academicYear: student.academicYear, status: 'Active' },
          { className: student.currentClass, sectionName: student.section || '' },
          { session }
        );
      }

      if (req.user) {
        await ActivityLog.create([{
          userId: req.user.id,
          action: 'UPDATED_STUDENT',
          details: `Updated full details and synchronized fees for student ${id}`
        }], { session });
      }

      await session.commitTransaction();
      session.endSession();

      res.json(student);
    } catch (innerError) {
      await session.abortTransaction();
      session.endSession();
      throw innerError;
    }
  } catch (error) {
    console.error("Update student error:", error);
    res.status(500).json({ error: error.message || 'Error updating student details' });
  }
};

export const promoteStudents = async (req, res) => {
  try {
    const { fromAcademicYear, toAcademicYear, classMapping } = req.body;

    if (!fromAcademicYear || !toAcademicYear || !classMapping) {
      return res.status(400).json({ error: 'fromAcademicYear, toAcademicYear, and classMapping are required.' });
    }

    const fromYearDoc = await AcademicYear.findOne({ year: fromAcademicYear });
    if (!fromYearDoc) {
      return res.status(400).json({ error: `Please create Academic Year ${fromAcademicYear} before promoting students.` });
    }

    const toYearDoc = await AcademicYear.findOne({ year: toAcademicYear });
    if (!toYearDoc) {
      return res.status(400).json({ error: `Please create Academic Year ${toAcademicYear} before promoting students.` });
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

          await StudentEnrollment.updateMany(
            { studentId: student._id, academicYear: fromAcademicYear, status: 'Active' },
            { $set: { status: 'Graduated', promotedDate: new Date() } }
          );

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

        // 4. Update previous enrollment record to Promoted
        await StudentEnrollment.updateMany(
          { studentId: student._id, academicYear: fromAcademicYear, status: 'Active' },
          { $set: { status: 'Promoted', promotedDate: new Date() } }
        );

        // 5. Create new enrollment record for next academic year
        await StudentEnrollment.create({
          studentId: student._id,
          academicYearId: toYearDoc._id,
          academicYear: toAcademicYear,
          className: nextClass,
          sectionName: student.section || '',
          status: 'Active',
          joinedDate: new Date()
        });

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