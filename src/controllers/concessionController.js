import { Student, StudentFee, FeeCategory, StudentFeeConcession, ActivityLog, User, Class, Section } from '../models/index.js';

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

    // 1. Build Student Query
    const studentQuery = {};
    if (className) studentQuery.currentClass = className;
    if (section) studentQuery.section = section;
    if (search) {
      studentQuery.$or = [
        { studentName: { $regex: search, $options: 'i' } },
        { admissionNumber: { $regex: search, $options: 'i' } }
      ];
    }
    if (admissionNumber) {
      studentQuery.admissionNumber = { $regex: admissionNumber, $options: 'i' };
    }

    // Retrieve matching students
    const students = await Student.find(studentQuery).lean();
    const studentIds = students.map(s => s._id);
    const studentMap = new Map(students.map(s => [s._id.toString(), s]));

    // If student filters are active and no students match, return empty array immediately
    if (studentIds.length === 0 && (className || section || search || admissionNumber)) {
      return res.json([]);
    }

    // 2. Build StudentFee Query
    const feeQuery = {};
    if (studentIds.length > 0) {
      feeQuery.studentId = { $in: studentIds };
    }
    if (feeCategoryId) {
      feeQuery.feeCategoryId = feeCategoryId;
    }
    if (className) {
      feeQuery.className = className;
    }


    const studentFees = await StudentFee.find(feeQuery)
      .populate('feeCategoryId')
      .lean();

    const studentFeeIds = studentFees.map(f => f._id);

    // 3. Build Concession Query
    const concessionQuery = {};
    if (studentFeeIds.length > 0) {
      concessionQuery.studentFeeId = { $in: studentFeeIds };
    }
    if (reason) {
      concessionQuery.reason = reason;
    }
    if (assignedBy) {
      concessionQuery.createdBy = assignedBy;
    }
    if (startDate || endDate) {
      concessionQuery.createdAt = {};
      if (startDate) concessionQuery.createdAt.$gte = new Date(startDate);
      if (endDate) concessionQuery.createdAt.$lte = new Date(endDate);
    }

    // Find active concessions matching concession filters
    const concessions = await StudentFeeConcession.find(concessionQuery)
      .populate('createdBy', 'username')
      .populate('updatedBy', 'username')
      .populate('deletedBy', 'username')
      .lean();

    // Map concessions by studentFeeId (active ones take precedence or we map the active one)
    const concessionMap = new Map();
    concessions.forEach(c => {
      // If active, map it. If multiple, map the active one or most recent one
      const key = c.studentFeeId.toString();
      if (!concessionMap.has(key) || c.status === 'Active') {
        concessionMap.set(key, c);
      }
    });

    // 4. Merge data to form the table response
    let result = studentFees.map(fee => {
      const student = studentMap.get(fee.studentId.toString());
      if (!student) return null; // skip if student not found in filtered list

      const concession = concessionMap.get(fee._id.toString());
      
      const originalAmount = fee.totalAmount || 0;
      const lessAmount = concession ? concession.lessAmount : 0;
      const netPayable = (concession && concession.status === 'Active') 
        ? Math.max(0, originalAmount - lessAmount) 
        : originalAmount;

      return {
        _id: fee._id,
        studentId: fee.studentId,
        studentFeeId: fee._id,
        admissionNumber: student.admissionNumber,
        studentName: student.studentName,
        className: fee.className || student.currentClass,
        section: student.section,
        feeCategory: fee.feeCategoryId?.name || 'Unknown',
        feeCategoryId: fee.feeCategoryId?._id,
        originalAmount,
        lessAmount,
        netPayable,
        reason: concession ? concession.reason : '',
        remarks: concession ? concession.remarks : '',
        assignedBy: concession?.createdBy?.username || '',
        assignedDate: concession ? concession.createdAt : null,
        status: concession ? concession.status : 'None',
        concessionId: concession ? concession._id : null
      };
    }).filter(Boolean);

    // If concession-specific filters are active, we should filter out records that don't have concessions matching the filter
    if (reason || assignedBy || startDate || endDate) {
      result = result.filter(r => r.status !== 'None');
    }

    res.json(result);
  } catch (error) {
    console.error('Error fetching student fees with concessions:', error);
    res.status(500).json({ error: 'Error fetching student fees and concessions' });
  }
};

// Create / Assign Concession (handles Single and Bulk assignment)
export const createConcession = async (req, res) => {
  try {
    const { studentIds, feeCategoryId, academicYear, lessAmount, reason, remarks } = req.body;

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

      // Find or create StudentFee record
      let studentFee = await StudentFee.findOne({
        studentId,
        feeCategoryId,
        className: student.currentClass
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
        
        const resolvedAY = academicYear || student.academicYear || '2028-2029';
        
        // Create the StudentFee record on the fly
        studentFee = await StudentFee.create({
          studentId,
          feeCategoryId,
          totalAmount,
          paidAmount: 0,
          remainingAmount: totalAmount,
          className: student.currentClass,
          section: student.section,
          academicYear: resolvedAY
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

      // Resolve academic year from student
      const resolvedAY = academicYear || student.academicYear || '2028-2029';

      // Create new concession
      const newConcession = await StudentFeeConcession.create({
        studentId,
        studentFeeId: studentFee._id,
        academicYear: resolvedAY,
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

    if (concession.status !== 'Active') {
      return res.status(400).json({ error: 'Cannot update an inactive or cancelled concession.' });
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

    // 2. Fetch all concessions (active and inactive) for this student
    const concessions = await StudentFeeConcession.find({
      studentId,
      status: { $in: ['Active', 'Inactive'] }
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
      const concession = concessions.find(c => 
        (fee && c.studentFeeId.toString() === fee._id.toString()) || 
        c.feeCategoryId.toString() === cat._id.toString()
      );

      const lessAmount = concession ? concession.lessAmount : 0;
      const netPayable = (concession && concession.status === 'Active')
        ? Math.max(0, originalAmount - lessAmount)
        : originalAmount;

      return {
        feeCategoryId: cat._id,
        feeCategoryName: cat.name,
        academicYear: fee ? fee.academicYear : (student.academicYear || ''),
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
