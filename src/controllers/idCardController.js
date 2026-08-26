import { Student, Class, Section, AcademicYear } from '../models/index.js';

export const getIdCards = async (req, res) => {
  try {
    const { academicYear, currentClass, className, section, studentStatus, RTE, rteType, search } = req.query;

    const whereClause = {};

    const targetClass = currentClass || className;
    if (targetClass && targetClass.trim()) {
      whereClause.currentClass = targetClass.trim();
    }

    if (section && section.trim()) {
      whereClause.section = section.trim();
    }

    if (academicYear && academicYear.trim()) {
      whereClause.academicYear = academicYear.trim();
    }

    if (studentStatus && studentStatus !== 'all' && studentStatus.trim()) {
      whereClause.studentStatus = studentStatus.trim();
    } else {
      whereClause.studentStatus = { $ne: 'Inactive' };
    }

    const typeFilter = RTE || rteType;
    if (typeFilter && typeFilter !== 'all') {
      if (typeFilter === 'RTE') {
        whereClause.$or = [
          { isRTE: true },
          { RTE: { $in: ['RTE', 'Yes', 'yes'] } }
        ];
      } else if (typeFilter === 'General') {
        whereClause.$and = [
          { isRTE: { $ne: true } },
          { RTE: { $nin: ['RTE', 'Yes', 'yes'] } }
        ];
      }
    }

    if (search && search.trim()) {
      const q = search.trim();
      const searchOr = [
        { studentName: { $regex: q, $options: 'i' } },
        { admissionNumber: { $regex: q, $options: 'i' } }
      ];
      if (whereClause.$or) {
        const existingOr = whereClause.$or;
        delete whereClause.$or;
        whereClause.$and = whereClause.$and || [];
        whereClause.$and.push({ $or: existingOr }, { $or: searchOr });
      } else if (whereClause.$and) {
        whereClause.$and.push({ $or: searchOr });
      } else {
        whereClause.$or = searchOr;
      }
    }

    const students = await Student.find(whereClause)
      .select('_id admissionNumber studentName currentClass section academicYear RTE isRTE studentStatus photoUrl passport_photo address fatherPhone motherPhone dateOfBirth whatsappNumber')
      .sort({ studentName: 1 })
      .lean();

    const result = students.map(s => {
      const isRTE = s.isRTE || s.RTE === 'RTE' || s.RTE === 'Yes' || s.RTE === 'yes';
      const photo = s.passport_photo || s.photoUrl || '';
      return {
        _id: s._id,
        admissionNumber: s.admissionNumber,
        studentName: s.studentName,
        currentClass: s.currentClass,
        section: s.section || 'A',
        academicYear: s.academicYear || '',
        studentStatus: s.studentStatus || 'Active',
        courseType: isRTE ? 'RTE' : 'General',
        photoUrl: photo,
        passport_photo: photo,
        address: s.address || '',
        phone: s.fatherPhone || s.motherPhone || s.whatsappNumber || '',
        fatherPhone: s.fatherPhone || '',
        motherPhone: s.motherPhone || '',
        whatsappNumber: s.whatsappNumber || ''
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching ID cards:', error);
    res.status(500).json({ error: 'Error fetching ID card data' });
  }
};

export const getIdCardByStudentId = async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await Student.findById(studentId).lean();
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const photo = student.passport_photo || student.photoUrl || '';
    const isRTE = student.isRTE || student.RTE === 'RTE' || student.RTE === 'Yes' || student.RTE === 'yes';

    res.json({
      _id: student._id,
      admissionNumber: student.admissionNumber,
      studentName: student.studentName,
      currentClass: student.currentClass,
      section: student.section || 'A',
      academicYear: student.academicYear || '',
      studentStatus: student.studentStatus || 'Active',
      courseType: isRTE ? 'RTE' : 'General',
      photoUrl: photo,
      passport_photo: photo,
      address: student.address || '',
      phone: student.fatherPhone || student.motherPhone || student.whatsappNumber || '',
      fatherPhone: student.fatherPhone || '',
      motherPhone: student.motherPhone || '',
      whatsappNumber: student.whatsappNumber || ''
    });
  } catch (error) {
    console.error('Error fetching student ID card details:', error);
    res.status(500).json({ error: 'Error fetching student ID card' });
  }
};

export const generateIdCards = async (req, res) => {
  try {
    const { studentIds } = req.body;
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one student.' });
    }

    const students = await Student.find({ _id: { $in: studentIds } }).lean();
    const cards = students.map(s => {
      const photo = s.passport_photo || s.photoUrl || '';
      return {
        _id: s._id,
        admissionNumber: s.admissionNumber,
        studentName: s.studentName,
        currentClass: s.currentClass,
        section: s.section || 'A',
        academicYear: s.academicYear || '',
        photoUrl: photo,
        passport_photo: photo,
        address: s.address || '',
        phone: s.fatherPhone || s.motherPhone || s.whatsappNumber || '',
        fatherPhone: s.fatherPhone || '',
        motherPhone: s.motherPhone || '',
        whatsappNumber: s.whatsappNumber || ''
      };
    });

    res.json({
      message: `Generated ${cards.length} ID Card(s) successfully`,
      count: cards.length,
      cards
    });
  } catch (error) {
    console.error('Error generating ID cards:', error);
    res.status(500).json({ error: 'Error generating ID cards' });
  }
};

export const downloadIdCards = async (req, res) => {
  try {
    const { studentIds } = req.body;
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one student.' });
    }

    const students = await Student.find({ _id: { $in: studentIds } }).lean();
    res.json({
      message: `Batch payload prepared for ${students.length} student(s)`,
      count: students.length,
      studentIds
    });
  } catch (error) {
    console.error('Error preparing ID cards download:', error);
    res.status(500).json({ error: 'Error preparing download' });
  }
};
