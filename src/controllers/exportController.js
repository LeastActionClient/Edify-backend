import {
  Student,
  StudentFee,
  Payment,
  StudentIncludedCharge,
  StudentActivity,
  ExportLog,
  Class,
  FeeCategory,
  StudentFeeConcession
} from '../models/index.js';
import PDFDocument from 'pdfkit';
import xlsx from 'xlsx';

const adjustFeesWithActiveConcessions = async (studentFees) => {
  if (!studentFees || studentFees.length === 0) return studentFees;
  
  const feeIds = studentFees.map(f => f._id);
  const concessions = await StudentFeeConcession.find({
    studentFeeId: { $in: feeIds },
    status: { $in: ['Active', 'Inactive'] }
  }).lean();
  
  const concessionMap = new Map(concessions.map(c => [c.studentFeeId.toString(), c]));
  
  return studentFees.map(fee => {
    const fObj = fee.toObject ? fee.toObject() : { ...fee };
    const concession = concessionMap.get(fObj._id.toString());
    if (concession) {
      fObj.lessAmount = concession.lessAmount;
      fObj.concessionStatus = concession.status;
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
};

export const exportStudents = async (req, res) => {
  try {
    const {
      exportScope, // 'SELECTED', 'SINGLE', 'FILTERED', 'CLASS', 'SECTION', 'ACADEMIC_YEAR', 'OLD_STUDENTS'
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
    if (exportScope === 'SINGLE' || exportScope === 'SELECTED' || exportScope === 'FILTERED') {
      if (!studentIds || studentIds.length === 0) {
        return res.status(400).json({ error: 'No students selected for export.' });
      }
      query._id = { $in: studentIds };
    } else if (exportScope === 'CLASS') {
      if (!classFilter) return res.status(400).json({ error: 'Class is required.' });
      query.currentClass = classFilter;
      if (sectionFilter && sectionFilter !== 'All') {
        query.section = sectionFilter;
      }
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
    if (exportScope === 'OLD_STUDENTS' && exitType && exitType !== 'All') {
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
    let [studentFees, payments, includedCharges, activities] = await Promise.all([
      StudentFee.find({ studentId: { $in: fetchedStudentIds } }).populate('feeCategoryId').lean(),
      Payment.find({ studentId: { $in: fetchedStudentIds } }).sort({ paymentDate: -1 }).lean(),
      StudentIncludedCharge.find({ studentId: { $in: fetchedStudentIds } }).populate('includedChargeId').lean(),
      StudentActivity.find({ studentId: { $in: fetchedStudentIds } }).populate('activityId').lean()
    ]);

    studentFees = await adjustFeesWithActiveConcessions(studentFees);

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

      // Calculate pending — same logic as Students page frontend
      const totalPending = student.fees.reduce((sum, f) => sum + (f.remainingAmount || 0), 0);
      const hasFees = student.fees.length > 0;
      student.totalPending = totalPending;

      let keep = true;
      if (feeStatus === 'Pending' && totalPending <= 0) keep = false;
      if (feeStatus === 'Paid' && (!hasFees || totalPending > 0)) keep = false;
      
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

      const formatDateToYYYYMMDD = (dateVal) => {
        if (!dateVal) return '';
        const date = new Date(dateVal);
        if (isNaN(date.getTime())) return '';
        return date.toISOString().split('T')[0];
      };

      const exportRows = finalStudents.map(student => {
        const totalFee = student.fees.reduce((sum, f) => sum + (f.totalAmount || 0), 0);
        const totalPaid = student.fees.reduce((sum, f) => sum + (f.paidAmount || 0), 0);
        const pendingDetails = student.fees
          .filter(f => f.remainingAmount > 0)
          .map(f => `${f.feeCategoryId?.name || 'Unknown'}: Rs.${f.remainingAmount}`)
          .join(', ');

        return {
          'Student Name': student.studentName || '',
          'Admission No': student.admissionNumber || '',
          'EMIS No': student.emisNo || student.emisNumber || '',
          'DOB': formatDateToYYYYMMDD(student.dateOfBirth),
          'Gender / Sex': student.gender || '',
          'Blood Group': student.bloodGroup || '',
          'Aadhar No': student.aadhaarNumber || '',
          'Religion': student.religion || '',
          'Community': student.community || '',
          'Caste': student.caste || '',
          'RTE': student.RTE || '',
          'Nationality': student.nationality || '',
          'Father Name': student.fatherName || '',
          'Father Phone': student.fatherPhone || '',
          'Father Occupation': student.fatherOccupation || '',
          'Mother Name': student.motherName || '',
          'Mother Phone': student.motherPhone || '',
          'Mother Occupation': student.motherOccupation || '',
          'Guardian Name': student.guardianName || student.guardian || '',
          'Whatsapp Number': student.whatsappNumber || '',
          'Address': student.address || '',
          'City': student.city || '',
          'State': student.state || '',
          'Pincode': student.pincode || '',
          'Total Fee': totalFee,
          'Paid Amount': totalPaid,
          'Pending Fee': student.totalPending,
          'Pending Details': pendingDetails || 'None'
        };
      });

      const ws = xlsx.utils.json_to_sheet(exportRows, {
        header: [
          'Student Name',
          'Admission No',
          'EMIS No',
          'DOB',
          'Gender / Sex',
          'Blood Group',
          'Aadhar No',
          'Religion',
          'Community',
          'Caste',
          'RTE',
          'Nationality',
          'Father Name',
          'Father Phone',
          'Father Occupation',
          'Mother Name',
          'Mother Phone',
          'Mother Occupation',
          'Guardian Name',
          'Whatsapp Number',
          'Address',
          'City',
          'State',
          'Pincode',
          'Total Fee',
          'Paid Amount',
          'Pending Fee',
          'Pending Details'
        ]
      });

      xlsx.utils.book_append_sheet(wb, ws, 'Students');

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
        doc.text(`EMIS No: ${student.emisNo || student.emisNumber || 'N/A'}`);
        doc.text(`Name: ${student.studentName}`);
        doc.text(`Class & Section: ${student.currentClass} ${student.section || ''}`);
        doc.text(`DOB: ${student.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString() : 'N/A'}`);
        doc.text(`Gender: ${student.gender || 'N/A'}`);
        doc.text(`Caste: ${student.caste || 'N/A'}`);
        doc.text(`Aadhaar: ${student.aadhaarNumber || 'N/A'}`);
        doc.text(`Status: ${student.studentStatus || 'Active'}`);
        doc.moveDown(1.5);

        // Parent Details
        doc.fontSize(14).fillColor('#ea580c').text('Parent Details');
        doc.fillColor('black').fontSize(10).moveDown(0.5);
        doc.text(`Father's Name: ${student.fatherName || 'N/A'}`);
        doc.text(`Father's Phone: ${student.fatherPhone || 'N/A'}`);
        doc.text(`Mother's Name: ${student.motherName || 'N/A'}`);
        doc.text(`Guardian Name: ${student.guardianName || student.guardian || 'N/A'}`);
        doc.text(`WhatsApp Number: ${student.whatsappNumber || 'N/A'}`);
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
            let desc = `- ${f.feeCategoryId?.name || 'Unknown'}: Total Rs.${f.totalAmount}`;
            if (f.lessAmount > 0) {
              desc += `, Less Rs.${f.lessAmount} (${f.concessionStatus})`;
            }
            desc += `, Paid Rs.${f.paidAmount}, Pending Rs.${f.remainingAmount}`;
            doc.text(desc);
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
