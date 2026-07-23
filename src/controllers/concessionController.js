import { Student, StudentFee, FeeCategory, StudentFeeConcession, ActivityLog, User, Class, Section, AcademicYear, StudentEnrollment } from '../models/index.js';

const EFFECTIVE_CONCESSION_STATUSES = new Set(['Active', 'Completed', 'Expired']);
const DISPLAY_CONCESSION_STATUSES = new Set(['Active', 'Inactive', 'Completed', 'Expired', 'Cancelled']);

const getConcessionNetPayable = (originalAmount, lessAmount, status) => {
  const original = Number(originalAmount) || 0;
  const discount = Number(lessAmount) || 0;

  if (!EFFECTIVE_CONCESSION_STATUSES.has(status)) {
    return original;
  }

  return Math.max(0, original - discount);
};

const resolveAcademicYearContext = async ({ academicYear, student, studentFee }) => {
  const enrollment = await StudentEnrollment.findOne({ studentId: student._id, status: 'Active' })
    .select('academicYearId academicYear')
    .sort({ joinedDate: -1, createdAt: -1 })
    .lean();

  const resolvedAcademicYear = academicYear || enrollment?.academicYear || studentFee?.academicYear || student.academicYear || '';
  const yearVariants = resolvedAcademicYear
    ? [
        resolvedAcademicYear,
        String(resolvedAcademicYear).replace(/-/g, '–'),
        String(resolvedAcademicYear).replace(/[\u2013]/g, '-')
      ].filter(Boolean)
    : [];
  const resolvedAcademicYearDoc = yearVariants.length > 0
    ? await AcademicYear.findOne({ year: { $in: yearVariants } }).select('_id year status').lean()
    : null;

  return {
    academicYear: resolvedAcademicYear,
    academicYearId: resolvedAcademicYearDoc?._id || enrollment?.academicYearId || null
  };
};

// Get student fees with concessions (main student table for Super Admin & Admin)
export const getStudentFeesWithConcessions = async (req, res) => {
  try {
    const {
      academicYear,
      className,
      section,
      feeCategoryId,
      search,
      admissionNumber,
      reason,
      assignedBy,
      startDate,
      endDate
    } = req.query;

    const concessionQuery = {};

    if (academicYear) {
      concessionQuery.academicYear = academicYear;
    }
    if (className) {
      concessionQuery.className = className;
    }
    if (section) {
      concessionQuery.section = section;
    }
    if (feeCategoryId) {
      concessionQuery.feeCategoryId = feeCategoryId;
    }
    if (reason) {
      concessionQuery.reason = { $regex: reason, $options: 'i' };
    }
    if (assignedBy) {
      concessionQuery.createdBy = assignedBy;
    }
    if (startDate || endDate) {
      concessionQuery.createdAt = {};
      if (startDate) concessionQuery.createdAt.$gte = new Date(startDate);
      if (endDate) concessionQuery.createdAt.$lte = new Date(endDate);
    }

    // Filter by student-specific search parameters if provided
    if (search || admissionNumber) {
      const studentQuery = {};
      if (search) {
        studentQuery.$or = [
          { studentName: { $regex: search, $options: 'i' } },
          { admissionNumber: { $regex: search, $options: 'i' } }
        ];
      }
      if (admissionNumber) {
        studentQuery.admissionNumber = { $regex: admissionNumber, $options: 'i' };
      }
      const matchedStudents = await Student.find(studentQuery).select('_id').lean();
      const studentIds = matchedStudents.map(s => s._id);
      concessionQuery.studentId = { $in: studentIds };
    }

    const concessions = await StudentFeeConcession.find(concessionQuery)
      .populate('studentId')
      .populate('feeCategoryId')
      .populate('createdBy', 'username')
      .populate('updatedBy', 'username')
      .populate('deletedBy', 'username')
      .sort({ createdAt: -1 })
      .lean();

    const result = concessions.map(c => {
      if (!c.studentId) return null;

      const originalAmount = c.originalAmount || 0;
      const lessAmount = c.lessAmount || 0;
      const netPayable = getConcessionNetPayable(originalAmount, lessAmount, c.status);

      return {
        _id: c.studentFeeId || c._id,
        studentId: c.studentId._id,
        studentFeeId: c.studentFeeId,
        academicYearId: c.academicYearId || null,
        admissionNumber: c.studentId.admissionNumber,
        studentName: c.studentId.studentName,
        className: c.className || c.studentId.currentClass,
        section: c.section || c.studentId.section,
        feeCategory: c.feeCategoryId?.name || 'Unknown',
        feeCategoryId: c.feeCategoryId?._id,
        originalAmount,
        lessAmount,
        netPayable,
        reason: c.reason || '',
        remarks: c.remarks || '',
        assignedBy: c.createdBy?.username || '',
        assignedDate: c.createdAt,
        status: c.status || 'None',
        concessionId: c._id
      };
    }).filter(Boolean);

    res.json(result);
  } catch (error) {
    console.error('Error fetching concessions:', error);
    res.status(500).json({ error: 'Error fetching concessions history' });
  }
};

// Create / Assign Concession (handles Single and Bulk assignment)
export const createConcession = async (req, res) => {
  try {
    const { studentIds, feeCategoryId, academicYear, academicYearId, lessAmount, reason, remarks } = req.body;

    // 1. Validation
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'At least one student must be selected.' });
    }
    if (!feeCategoryId) {
      return res.status(400).json({ error: 'Fee Category is required.' });
    }
    if (lessAmount === undefined || lessAmount === null || isNaN(lessAmount)) {
      return res.status(400).json({ error: 'Less Amount is required and must be a number.' });
    }
    const parsedLessAmount = parseFloat(lessAmount);
    if (parsedLessAmount <= 0) {
      return res.status(400).json({ error: 'Less Amount must be greater than 0.' });
    }
    if (!reason) {
      return res.status(400).json({ error: 'Reason is required.' });
    }

    const createdBy = req.user.id;
    const results = [];

    const categoryDoc = await FeeCategory.findById(feeCategoryId).lean();
    const isUniform = categoryDoc?.name?.toLowerCase() === 'uniform';

    // Process each student
    for (const studentId of studentIds) {
      const student = await Student.findById(studentId);
      if (!student) {
        return res.status(404).json({ error: `Student with ID ${studentId} not found.` });
      }

      const academicYearContext = await resolveAcademicYearContext({
        academicYear,
        student
      });
      if (!academicYearContext.academicYear || !academicYearContext.academicYearId) {
        return res.status(400).json({ error: `Academic year is required for ${student.studentName}. Please ensure the academic year exists before assigning a concession.` });
      }

      // Find or create StudentFee record
      let studentFee = await StudentFee.findOne({
        studentId,
        feeCategoryId,
        className: student.currentClass,
        academicYear: academicYearContext.academicYear
      });

      if (!studentFee) {
        // Resolve default fee config from Class & Section
        const classDoc = await Class.findOne({ name: student.currentClass }).lean();
        const classDefaultFees = classDoc?.defaultFees || {};
        
        let sectionDefaultFees = {};
        if (classDoc && student.section) {
          const sectionDoc = await Section.findOne({ name: student.section, classId: classDoc._id }).lean();
          sectionDefaultFees = sectionDoc?.defaultFees || {};
        }
        
        const mergedDefaultFees = { ...classDefaultFees, ...sectionDefaultFees };
        const feeConfig = mergedDefaultFees[feeCategoryId.toString()];
        
        let totalAmount = 0;
        if (typeof feeConfig === 'number') {
          totalAmount = feeConfig;
        } else if (feeConfig && typeof feeConfig === 'object') {
          totalAmount = parseFloat(feeConfig.amount) || 0;
          if (isUniform && feeConfig.pricing) {
            const topPrice = parseFloat(feeConfig.pricing.topPerMetre || 0);
            const bottomPrice = parseFloat(feeConfig.pricing.bottomPerMetre || 0);
            totalAmount = topPrice + bottomPrice;
          }
        }
        
        if (totalAmount === 0 && (!feeConfig || feeConfig.assigned === undefined)) {
          return res.status(400).json({
            error: `Fee category is not assigned to student ${student.studentName} (${student.admissionNumber}) and no default amount is configured for this class/section.`
          });
        }
        
        // Create the StudentFee record on the fly
        studentFee = await StudentFee.create({
          studentId,
          feeCategoryId,
          totalAmount,
          paidAmount: 0,
          remainingAmount: totalAmount,
          className: student.currentClass,
          section: student.section,
          academicYear: academicYearContext.academicYear
        });
      }

      // Validate: Less Amount cannot exceed Original Fee (skip if it is uniform and student has no measurements yet)
      if (!isUniform && parsedLessAmount > studentFee.totalAmount) {
        return res.status(400).json({
          error: `Concession amount (₹${parsedLessAmount}) cannot exceed the Original Fee (₹${studentFee.totalAmount}) for ${student.studentName}.`
        });
      }

      // Deactivate any existing active concession for this student fee category
      const existingConcession = await StudentFeeConcession.findOne({
        studentId,
        studentFeeId: studentFee._id,
        academicYear: academicYearContext.academicYear,
        feeCategoryId,
        status: 'Active'
      });

      if (existingConcession) {
        existingConcession.status = 'Cancelled';
        existingConcession.deletedAt = new Date();
        existingConcession.deletedBy = createdBy;
        await existingConcession.save();

        // Audit log for deactivating previous concession
        await ActivityLog.create({
          userId: createdBy,
          action: 'CANCEL_CONCESSION_SUPER_ADMIN',
          details: `Cancelled previous concession of ₹${existingConcession.lessAmount} on ${student.studentName}'s fee category (ID: ${feeCategoryId}) due to new assignment.`
        });
      }

      // Create new concession
      const newConcession = await StudentFeeConcession.create({
        studentId,
        studentFeeId: studentFee._id,
        academicYear: academicYearContext.academicYear,
        academicYearId: academicYearId || academicYearContext.academicYearId || null,
        className: studentFee.className || student.currentClass,
        section: student.section,
        feeCategoryId,
        originalAmount: studentFee.totalAmount,
        lessAmount: parsedLessAmount,
        reason,
        remarks: remarks || '',
        status: 'Active',
        createdBy
      });

      // Audit log for creating new concession
      await ActivityLog.create({
        userId: createdBy,
        action: 'CREATE_CONCESSION_SUPER_ADMIN',
        details: `Assigned concession of ₹${parsedLessAmount} (Reason: ${reason}) on ${student.studentName}'s fee category (ID: ${feeCategoryId}). Original amount: ₹${studentFee.totalAmount}.`
      });


      results.push(newConcession);
    }

    res.status(201).json({
      message: `Successfully assigned concession to ${results.length} student(s).`,
      concessions: results
    });
  } catch (error) {
    console.error('Error creating concession:', error);
    res.status(500).json({ error: 'Error creating fee concession' });
  }
};

// Update Concession
export const updateConcession = async (req, res) => {
  try {
    const { id } = req.params;
    const { lessAmount, reason, remarks } = req.body;

    // 1. Validation
    if (lessAmount === undefined || lessAmount === null || isNaN(lessAmount)) {
      return res.status(400).json({ error: 'Less Amount is required and must be a number.' });
    }
    const parsedLessAmount = parseFloat(lessAmount);
    if (parsedLessAmount <= 0) {
      return res.status(400).json({ error: 'Less Amount must be greater than 0.' });
    }
    if (!reason) {
      return res.status(400).json({ error: 'Reason is required.' });
    }

    const concession = await StudentFeeConcession.findById(id).populate('studentId').populate('feeCategoryId');
    if (!concession) {
      return res.status(404).json({ error: 'Concession not found.' });
    }

    if (!['Active', 'Inactive'].includes(concession.status)) {
      return res.status(400).json({ error: 'Cannot update a completed, expired, or cancelled concession.' });
    }

    // Retrieve student fee to check original fee limit
    const studentFee = await StudentFee.findById(concession.studentFeeId);
    if (!studentFee) {
      return res.status(404).json({ error: 'Associated Student Fee record not found.' });
    }

    const isUniform = concession.feeCategoryId?.name?.toLowerCase() === 'uniform';
    if (!isUniform && parsedLessAmount > studentFee.totalAmount) {
      return res.status(400).json({
        error: `Concession amount (₹${parsedLessAmount}) cannot exceed the Original Fee (₹${studentFee.totalAmount}).`
      });
    }

    const oldLessAmount = concession.lessAmount;
    const oldReason = concession.reason;

    // Update concession details
    concession.lessAmount = parsedLessAmount;
    concession.reason = reason;
    if (remarks !== undefined) concession.remarks = remarks;
    concession.updatedBy = req.user.id;
    await concession.save();

    // Audit log
    await ActivityLog.create({
      userId: req.user.id,
      action: 'UPDATE_CONCESSION_SUPER_ADMIN',
      details: `Updated concession ID ${id} for student ${concession.studentId?.studentName || concession.studentId}. Less amount changed from ₹${oldLessAmount} to ₹${parsedLessAmount}. Reason changed from "${oldReason}" to "${reason}".`
    });

    res.json({
      message: 'Concession updated successfully.',
      concession
    });
  } catch (error) {
    console.error('Error updating concession:', error);
    res.status(500).json({ error: 'Error updating fee concession' });
  }
};

// Delete (Cancel) Concession (Soft Delete)
export const deleteConcession = async (req, res) => {
  try {
    const { id } = req.params;

    const concession = await StudentFeeConcession.findById(id).populate('studentId');
    if (!concession) {
      return res.status(404).json({ error: 'Concession not found.' });
    }

    if (concession.status === 'Cancelled') {
      return res.status(400).json({ error: 'Concession is already cancelled.' });
    }

    concession.status = 'Cancelled';
    concession.deletedAt = new Date();
    concession.deletedBy = req.user.id;
    await concession.save();

    // Audit log
    await ActivityLog.create({
      userId: req.user.id,
      action: 'DELETE_CONCESSION_SUPER_ADMIN',
      details: `Cancelled (soft deleted) concession ID ${id} of ₹${concession.lessAmount} for student ${concession.studentId?.studentName || concession.studentId}.`
    });

    res.json({
      message: 'Concession cancelled successfully.',
      concession
    });
  } catch (error) {
    console.error('Error cancelling concession:', error);
    res.status(500).json({ error: 'Error cancelling fee concession' });
  }
};

// Get Net Fee Calculation for a student
export const getStudentNetFees = async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await Student.findById(studentId).lean();
    if (!student) {
      return res.status(404).json({ error: 'Student not found.' });
    }

    // 1. Fetch all student fees already assigned
    const studentFees = await StudentFee.find({ studentId })
      .populate('feeCategoryId')
      .lean();

    // 2. Fetch all concessions for this student
    const concessions = await StudentFeeConcession.find({
      studentId,
      status: { $in: ['Active', 'Inactive', 'Completed', 'Expired', 'Cancelled'] }
    }).lean();

    // 3. Fetch all fee categories in the system
    const allCategories = await FeeCategory.find().lean();

    // 4. Fetch student's class and section configurations for default fees
    const classDoc = await Class.findOne({ name: student.currentClass }).lean();
    const classDefaultFees = classDoc?.defaultFees || {};

    let sectionDefaultFees = {};
    if (classDoc && student.section) {
      const sectionDoc = await Section.findOne({ name: student.section, classId: classDoc._id }).lean();
      sectionDefaultFees = sectionDoc?.defaultFees || {};
    }

    const mergedDefaultFees = { ...classDefaultFees, ...sectionDefaultFees };

    const result = allCategories.map(cat => {
      // Find if student has a StudentFee record for this category
      const fee = studentFees.find(f => f.feeCategoryId?._id.toString() === cat._id.toString());
      
      // Determine originalAmount
      let originalAmount = 0;
      let pricingLabel = null;
      const feeConfig = mergedDefaultFees[cat._id.toString()];

      if (fee) {
        originalAmount = fee.totalAmount || 0;
        if (cat.name.toLowerCase() === 'uniform' && originalAmount === 0 && (!fee.uniformDetails || (fee.uniformDetails.topLength === 0 && fee.uniformDetails.bottomLength === 0))) {
          if (feeConfig?.pricing) {
            pricingLabel = `₹${feeConfig.pricing.topPerMetre}/m top, ₹${feeConfig.pricing.bottomPerMetre}/m bottom`;
            const topPrice = parseFloat(feeConfig.pricing.topPerMetre || 0);
            const bottomPrice = parseFloat(feeConfig.pricing.bottomPerMetre || 0);
            originalAmount = topPrice + bottomPrice;
          }
        }
      } else {
        if (typeof feeConfig === 'number') {
          originalAmount = feeConfig;
        } else if (feeConfig && typeof feeConfig === 'object') {
          originalAmount = parseFloat(feeConfig.amount) || 0;
          if (cat.name.toLowerCase() === 'uniform' && feeConfig.pricing) {
            pricingLabel = `₹${feeConfig.pricing.topPerMetre}/m top, ₹${feeConfig.pricing.bottomPerMetre}/m bottom`;
            const topPrice = parseFloat(feeConfig.pricing.topPerMetre || 0);
            const bottomPrice = parseFloat(feeConfig.pricing.bottomPerMetre || 0);
            originalAmount = topPrice + bottomPrice;
          }
        }
      }

      // Find concession for this category (either via studentFeeId or feeCategoryId)
      const concession = concessions.find(c => fee && c.studentFeeId.toString() === fee._id.toString());

      const lessAmount = concession ? concession.lessAmount : 0;
      const netPayable = concession ? getConcessionNetPayable(originalAmount, lessAmount, concession.status) : originalAmount;

      return {
        feeCategoryId: cat._id,
        feeCategoryName: cat.name,
        academicYear: fee ? fee.academicYear : (student.academicYear || ''),
        academicYearId: fee?.academicYearId || concession?.academicYearId || null,
        className: fee ? fee.className : student.currentClass,
        originalAmount,
        lessAmount,
        netPayable,
        concessionReason: concession ? concession.reason : null,
        concessionRemarks: concession ? concession.remarks : null,
        concessionStatus: concession ? concession.status : 'None',
        concessionId: concession ? concession._id : null,
        assignedBy: concession ? concession.createdBy : null,
        pricingLabel
      };
    });

    res.json({
      studentId: student._id,
      studentName: student.studentName,
      admissionNumber: student.admissionNumber,
      fees: result
    });
  } catch (error) {
    console.error('Error calculating net fees:', error);
    res.status(500).json({ error: 'Error calculating net fees' });
  }
};

// Get all concession records (for history/reporting)
export const getConcessionHistory = async (req, res) => {
  try {
    const concessions = await StudentFeeConcession.find()
      .populate('studentId', 'studentName admissionNumber')
      .populate('feeCategoryId', 'name')
      .populate('createdBy', 'username')
      .populate('updatedBy', 'username')
      .populate('deletedBy', 'username')
      .sort({ createdAt: -1 })
      .lean();

    res.json(concessions);
  } catch (error) {
    console.error('Error fetching concession history:', error);
    res.status(500).json({ error: 'Error fetching concession history' });
  }
};

// Toggle Concession Status (Active/Inactive)
export const toggleConcessionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    let { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required.' });
    }

    // Normalize status
    const upperStatus = status.toUpperCase();
    if (upperStatus !== 'ACTIVE' && upperStatus !== 'INACTIVE') {
      return res.status(400).json({ error: 'Invalid status. Must be ACTIVE or INACTIVE.' });
    }

    const targetStatus = upperStatus === 'ACTIVE' ? 'Active' : 'Inactive';

    const concession = await StudentFeeConcession.findById(id)
      .populate('studentId')
      .populate('feeCategoryId');

    if (!concession) {
      return res.status(404).json({ error: 'Concession not found.' });
    }

    if (!['Active', 'Inactive'].includes(concession.status)) {
      return res.status(400).json({ error: 'Only active or inactive concessions can be toggled.' });
    }

    const oldStatus = concession.status;
    concession.status = targetStatus;
    concession.updatedBy = req.user.id;
    await concession.save();

    // Audit log
    await ActivityLog.create({
      userId: req.user.id,
      action: 'UPDATE_CONCESSION_SUPER_ADMIN',
      details: `Toggled concession status for student ${concession.studentId?.studentName || 'Unknown'} (Fee Category: ${concession.feeCategoryId?.name || 'Unknown'}) from ${oldStatus} to ${targetStatus}.`
    });

    res.json({
      message: `Concession status updated to ${targetStatus} successfully.`,
      concession
    });
  } catch (error) {
    console.error('Error toggling concession status:', error);
    res.status(500).json({ error: 'Error toggling concession status' });
  }
};
