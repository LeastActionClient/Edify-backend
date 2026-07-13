import {
  Student,
  StudentFee,
  Payment,
  StudentIncludedCharge,
  StudentActivity,
  ExportLog,
  Class,
  FeeCategory
} from '../models/index.js';
import PDFDocument from 'pdfkit';
import xlsx from 'xlsx';

export const exportStudents = async (req, res) => {
  try {
    const {
      exportScope, // 'SELECTED', 'SINGLE', 'CLASS', 'SECTION', 'ACADEMIC_YEAR', 'OLD_STUDENTS'
      exportType, // 'PDF', 'Excel'
      studentIds, // Array of selected student IDs
      classFilter,
      sectionFilter,
      academicYear,
      exitType,
      feeStatus, // 'All', 'Pending', 'Paid'
      studentGroup, // 'All', 'RTE', 'General'
      searchName,
      searchAdmissionNumber
    } = req.body;

    let query = {};

    // Base query based on scope
    if (exportScope === 'SINGLE' || exportScope === 'SELECTED') {
      if (!studentIds || studentIds.length === 0) {
        return res.status(400).json({ error: 'No students selected for export.' });
      }
      query._id = { $in: studentIds };
    } else if (exportScope === 'CLASS') {
      if (!classFilter) return res.status(400).json({ error: 'Class is required.' });
      query.currentClass = classFilter;
      query.studentStatus = { $in: ['Active', null, ''] };
    } else if (exportScope === 'SECTION') {
      if (!classFilter || !sectionFilter) return res.status(400).json({ error: 'Class and section are required.' });
      query.currentClass = classFilter;
      query.section = sectionFilter;
      query.studentStatus = { $in: ['Active', null, ''] };
    } else if (exportScope === 'ACADEMIC_YEAR') {
      if (!academicYear) return res.status(400).json({ error: 'Academic year is required.' });
      query.academicYear = academicYear;
    } else if (exportScope === 'OLD_STUDENTS') {
      query.studentStatus = { $nin: ['Active', null, ''] };
      if (classFilter && classFilter !== 'All') query.currentClass = classFilter;
      if (sectionFilter && sectionFilter !== 'All') query.section = sectionFilter;
      if (academicYear && academicYear !== 'All') query.academicYear = academicYear;
    }

    // Apply additional filters
    if (exitType && exitType !== 'All') {
      query.studentStatus = exitType;
    }

    if (studentGroup === 'RTE') {
      query.RTE = { $regex: /rte/i };
    } else if (studentGroup === 'General') {
      query.$or = [{ RTE: null }, { RTE: '' }, { RTE: { $not: { $regex: /rte/i } } }];
    }

    if (searchName) {
      query.studentName = { $regex: searchName, $options: 'i' };
    }
    if (searchAdmissionNumber) {
      query.admissionNumber = { $regex: searchAdmissionNumber, $options: 'i' };
    }

    // Fetch students
    let students = await Student.find(query).lean();

    if (students.length === 0) {
      return res.status(404).json({ error: 'No students found matching criteria.' });
    }

    const fetchedStudentIds = students.map(s => s._id);

    // Fetch related data in bulk
    const [studentFees, payments, includedCharges, activities] = await Promise.all([
      StudentFee.find({ studentId: { $in: fetchedStudentIds } }).populate('feeCategoryId').lean(),
      Payment.find({ studentId: { $in: fetchedStudentIds } }).sort({ paymentDate: -1 }).lean(),
      StudentIncludedCharge.find({ studentId: { $in: fetchedStudentIds } }).populate('includedChargeId').lean(),
      StudentActivity.find({ studentId: { $in: fetchedStudentIds } }).populate('activityId').lean()
    ]);

    // Group related data by student
    const feeMap = {};
    const paymentMap = {};
    const chargeMap = {};
    const activityMap = {};

    studentFees.forEach(f => {
      if (!feeMap[f.studentId]) feeMap[f.studentId] = [];
      feeMap[f.studentId].push(f);
    });
    payments.forEach(p => {
      if (!paymentMap[p.studentId]) paymentMap[p.studentId] = [];
      paymentMap[p.studentId].push(p);
    });
    includedCharges.forEach(c => {
      if (!chargeMap[c.studentId]) chargeMap[c.studentId] = [];
      chargeMap[c.studentId].push(c);
    });
    activities.forEach(a => {
      if (!activityMap[a.studentId]) activityMap[a.studentId] = [];
      activityMap[a.studentId].push(a);
    });

    // Assemble student data and apply feeStatus filter
    let finalStudents = [];
    for (const student of students) {
      student.fees = feeMap[student._id] || [];
      student.payments = paymentMap[student._id] || [];
      student.includedCharges = chargeMap[student._id] || [];
      student.activities = activityMap[student._id] || [];

      // Calculate pending
      const fullFee = student.fees.find(f => f.feeCategoryId?.name?.toLowerCase().includes('full'));
      const totalPaid = student.fees.reduce((sum, f) => sum + f.paidAmount, 0);
      let totalPending = 0;
      if (fullFee) {
        totalPending = Math.max(0, fullFee.totalAmount - totalPaid);
      } else {
        totalPending = student.fees.reduce((sum, f) => sum + f.remainingAmount, 0);
      }
      student.totalPending = totalPending;

      let keep = true;
      if (feeStatus === 'Pending' && totalPending <= 0) keep = false;
      if (feeStatus === 'Paid' && totalPending > 0) keep = false;
      
      if (keep) finalStudents.push(student);
    }

    if (finalStudents.length === 0) {
      return res.status(404).json({ error: 'No students found matching criteria after fee status filter.' });
    }

    // Log export asynchronously
    ExportLog.create({
      exportScope,
      exportType,
      exportFilters: { classFilter, sectionFilter, academicYear, exitType, feeStatus, studentGroup },
      exportedBy: req.user.id,
      ipAddress: req.ip,
      numberOfStudentsExported: finalStudents.length
    }).catch(err => console.error('Error logging export', err));


    if (exportType === 'Excel') {
      const wb = xlsx.utils.book_new();

      const sheets = {
        'Student Details': [],
        'Parent Details': [],
        'Academic History': [],
        'Fee History': [],
        'Included Charges': [],
        'Activities': [],
        'Payment History': [],
        'Pending Fees': [],
        'Exit Details': []
      };

      for (const student of finalStudents) {
        const baseInfo = { 'Admission Number': student.admissionNumber, 'Student Name': student.studentName };

        sheets['Student Details'].push({
          ...baseInfo,
          'EMIS Number': student.emisNumber || '',
          'DOB': student.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString() : '',
          'Gender': student.gender || '',
          'Blood Group': student.bloodGroup || '',
          'Aadhaar Number': student.aadhaarNumber || '',
          'Religion': student.religion || '',
          'Community': student.community || '',
          'Caste': student.caste || '',
          'Nationality': student.nationality || '',
          'RCC/RTE': student.RTE || '',
          'Current Status': student.studentStatus || 'Active'
        });

        sheets['Parent Details'].push({
          ...baseInfo,
          'Father Name': student.fatherName || '',
          'Father Occupation': student.fatherOccupation || '',
          'Father Phone': student.fatherPhone || '',
          'Mother Name': student.motherName || '',
          'Mother Occupation': student.motherOccupation || '',
          'Mother Phone': student.motherPhone || '',
          'Guardian Name': student.guardian || '',
          'Address': student.address || '',
          'City': student.city || '',
          'State': student.state || '',
          'Pincode': student.pincode || ''
        });

        sheets['Academic History'].push({
          ...baseInfo,
          'Academic Year Joined': student.academicYear || '',
          'Admission Date': student.admissionDate ? new Date(student.admissionDate).toLocaleDateString() : '',
          'Current Class': student.currentClass || '',
          'Section': student.section || '',
          'Roll Number': student.rollNumber || ''
        });

        if (student.fees.length > 0) {
          student.fees.forEach(fee => {
            sheets['Fee History'].push({
              ...baseInfo,
              'Fee Category': fee.feeCategoryId?.name || 'Unknown',
              'Total Amount': fee.totalAmount,
              'Paid Amount': fee.paidAmount,
              'Remaining Amount': fee.remainingAmount,
              'Academic Year': fee.academicYear || 'Current',
              'Class': fee.className || 'Current'
            });
          });
        }

        if (student.includedCharges.length > 0) {
          student.includedCharges.forEach(charge => {
            sheets['Included Charges'].push({
              ...baseInfo,
              'Charge Name': charge.includedChargeId?.name || 'Unknown',
              'Amount': charge.totalAmount || charge.includedChargeId?.amount || 0,
              'Status': charge.isPaid ? 'Paid' : 'Pending',
              'Assigned Date': new Date(charge.createdAt).toLocaleDateString()
            });
          });
        }

        if (student.activities.length > 0) {
          student.activities.forEach(act => {
            sheets['Activities'].push({
              ...baseInfo,
              'Activity Name': act.activityId?.name || 'Unknown',
              'Amount': act.totalAmount || act.activityId?.amount || 0,
              'Status': act.isPaid ? 'Paid' : 'Pending',
              'Assigned Date': new Date(act.createdAt).toLocaleDateString()
            });
          });
        }

        if (student.payments.length > 0) {
          student.payments.forEach(pay => {
            sheets['Payment History'].push({
              ...baseInfo,
              'Receipt No': pay.receiptNumber || '',
              'Amount': pay.amount,
              'Payment Date': new Date(pay.paymentDate).toLocaleDateString(),
              'Payment Method': pay.paymentMethod || ''
            });
          });
        }

        sheets['Pending Fees'].push({
          ...baseInfo,
          'Total Pending Amount': student.totalPending
        });

        if (student.studentStatus && student.studentStatus !== 'Active') {
          sheets['Exit Details'].push({
            ...baseInfo,
            'Exit Type': student.studentStatus,
            'Exit Reason': '',
            'Exit Date': student.updatedAt ? new Date(student.updatedAt).toLocaleDateString() : ''
          });
        }
      }

      for (const sheetName in sheets) {
        if (sheets[sheetName].length > 0) {
          const ws = xlsx.utils.json_to_sheet(sheets[sheetName]);
          xlsx.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31)); // Excel max sheet name length is 31
        }
      }

      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', 'attachment; filename="student_export.xlsx"');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buffer);
      
    } else if (exportType === 'PDF') {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      res.setHeader('Content-Disposition', 'attachment; filename="student_export.pdf"');
      res.setHeader('Content-Type', 'application/pdf');
      doc.pipe(res);

      for (let i = 0; i < finalStudents.length; i++) {
        const student = finalStudents[i];
        if (i > 0) doc.addPage();

        doc.fontSize(20).font('Helvetica-Bold').text('Student Report', { align: 'center' });
        doc.moveDown(2);

        // Student Information
        doc.fontSize(14).fillColor('#ea580c').text('Student Information');
        doc.fillColor('black').fontSize(10).moveDown(0.5);
        doc.text(`Admission Number: ${student.admissionNumber}`);
        doc.text(`Name: ${student.studentName}`);
        doc.text(`Class & Section: ${student.currentClass} ${student.section || ''}`);
        doc.text(`DOB: ${student.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString() : 'N/A'}`);
        doc.text(`Gender: ${student.gender || 'N/A'}`);
        doc.text(`Aadhaar: ${student.aadhaarNumber || 'N/A'}`);
        doc.text(`Status: ${student.studentStatus || 'Active'}`);
        doc.moveDown(1.5);

        // Parent Details
        doc.fontSize(14).fillColor('#ea580c').text('Parent Details');
        doc.fillColor('black').fontSize(10).moveDown(0.5);
        doc.text(`Father's Name: ${student.fatherName || 'N/A'}`);
        doc.text(`Father's Phone: ${student.fatherPhone || 'N/A'}`);
        doc.text(`Mother's Name: ${student.motherName || 'N/A'}`);
        doc.text(`Address: ${student.address || 'N/A'}`);
        doc.moveDown(1.5);

        // Academic History
        doc.fontSize(14).fillColor('#ea580c').text('Academic History');
        doc.fillColor('black').fontSize(10).moveDown(0.5);
        doc.text(`Admission Date: ${student.admissionDate ? new Date(student.admissionDate).toLocaleDateString() : 'N/A'}`);
        doc.text(`Academic Year Joined: ${student.academicYear || 'N/A'}`);
        doc.moveDown(1.5);

        // Pending Fee Summary
        doc.fontSize(14).fillColor('#ea580c').text('Pending Fee Summary');
        doc.fillColor('black').fontSize(10).moveDown(0.5);
        doc.text(`Total Pending: Rs. ${student.totalPending.toFixed(2)}`);
        doc.moveDown(1.5);

        // Fee History
        if (student.fees.length > 0) {
          doc.fontSize(14).fillColor('#ea580c').text('Fee History');
          doc.fillColor('black').fontSize(10).moveDown(0.5);
          student.fees.forEach(f => {
            doc.text(`- ${f.feeCategoryId?.name || 'Unknown'}: Total Rs.${f.totalAmount}, Paid Rs.${f.paidAmount}, Pending Rs.${f.remainingAmount}`);
          });
          doc.moveDown(1.5);
        }

        // Included Charges
        if (student.includedCharges.length > 0) {
          doc.fontSize(14).fillColor('#ea580c').text('Included Charges');
          doc.fillColor('black').fontSize(10).moveDown(0.5);
          student.includedCharges.forEach(c => {
            const amt = c.totalAmount || c.includedChargeId?.amount || 0;
            const status = c.isPaid ? 'Paid' : 'Pending';
            doc.text(`- ${c.includedChargeId?.name || 'Unknown'}: Rs.${amt} (${status})`);
          });
          doc.moveDown(1.5);
        }

        // Activities
        if (student.activities.length > 0) {
          doc.fontSize(14).fillColor('#ea580c').text('Activities');
          doc.fillColor('black').fontSize(10).moveDown(0.5);
          student.activities.forEach(a => {
            const amt = a.totalAmount || a.activityId?.amount || 0;
            const status = a.isPaid ? 'Paid' : 'Pending';
            doc.text(`- ${a.activityId?.name || 'Unknown'}: Rs.${amt} (${status})`);
          });
          doc.moveDown(1.5);
        }
      }

      doc.end();
    } else {
      res.status(400).json({ error: 'Invalid export format' });
    }

  } catch (error) {
    console.error('Error generating export', error);
    res.status(500).json({ error: 'Error generating export' });
  }
};
