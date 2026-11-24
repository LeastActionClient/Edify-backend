import { BonafideCertificate, Student, AcademicYear } from '../models/index.js';

export const getCertificates = async (req, res) => {
  try {
    const { search, limit = 50 } = req.query;
    const query = {};

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { studentName: regex },
        { admissionNumber: regex },
        { serialNo: regex }
      ];
    }

    const certificates = await BonafideCertificate.find(query)
      .populate('studentId', 'studentName admissionNumber currentClass section photoUrl')
      .populate('createdById', 'username')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10))
      .lean();

    res.status(200).json({ success: true, certificates });
  } catch (error) {
    console.error('Error fetching bonafide certificates:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch certificates.' });
  }
};

export const getNextSerial = async (req, res) => {
  try {
    const activeYearDoc = await AcademicYear.findOne({ status: 'ACTIVE' }).lean();
    const currentYearStr = activeYearDoc ? activeYearDoc.year : `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;

    const count = await BonafideCertificate.countDocuments();
    const nextNum = count + 1;
    const padded = String(nextNum).padStart(3, '0');
    const serialNo = `SPES/BC/${currentYearStr}/${padded}`;

    res.status(200).json({
      success: true,
      serialNo,
      shortSerialNo: padded,
      nextNumber: nextNum,
      academicYear: currentYearStr
    });
  } catch (error) {
    console.error('Error generating next serial number:', error);
    res.status(500).json({ success: false, message: 'Failed to generate serial number.' });
  }
};

export const createCertificate = async (req, res) => {
  try {
    const {
      studentId,
      admissionNumber,
      serialNo,
      certificateDate,
      studentName,
      salutation,
      relation,
      parentSalutation,
      parentName,
      statusText,
      classGrade,
      academicYear,
      dateOfBirth,
      additionalText,
      purpose
    } = req.body;

    if (!studentId || !studentName) {
      return res.status(400).json({ success: false, message: 'Student ID and Student Name are required.' });
    }

    const student = await Student.findById(studentId).lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found in database.' });
    }

    const certificate = new BonafideCertificate({
      studentId,
      admissionNumber: admissionNumber || student.admissionNumber,
      serialNo: serialNo || `BC-${Date.now()}`,
      certificateDate: certificateDate ? new Date(certificateDate) : new Date(),
      studentName,
      salutation: salutation || 'Master',
      relation: relation || 'son of',
      parentSalutation: parentSalutation || 'Mr',
      parentName: parentName || student.fatherName || '',
      statusText: statusText || 'studying in',
      classGrade: classGrade || student.currentClass || '',
      academicYear: academicYear || student.academicYear || '',
      dateOfBirth: dateOfBirth || (student.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString('en-GB') : ''),
      additionalText: additionalText || '',
      purpose: purpose || '',
      createdById: req.user?._id
    });

    await certificate.save();

    res.status(201).json({ success: true, certificate, message: 'Bonafide Certificate recorded successfully.' });
  } catch (error) {
    console.error('Error creating bonafide certificate:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to save certificate.' });
  }
};

export const deleteCertificate = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await BonafideCertificate.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Certificate not found.' });
    }
    res.status(200).json({ success: true, message: 'Certificate deleted successfully.' });
  } catch (error) {
    console.error('Error deleting certificate:', error);
    res.status(500).json({ success: false, message: 'Failed to delete certificate.' });
  }
};
