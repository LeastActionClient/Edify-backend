import { Student, ProgressCard } from '../models/index.js';

const DEFAULT_SCHOLASTIC = [
  { subject: 'Tamil', mark: 57, grade: 'B' },
  { subject: 'English I', mark: 55, grade: 'B' },
  { subject: 'Maths', mark: 60, grade: 'B' },
  { subject: 'EVS', mark: 63, grade: 'B' },
  { subject: 'Com', mark: 83, grade: 'A' },
  { subject: 'Hindi', mark: 76, grade: 'B+' },
  { subject: 'ENGLISH II', mark: 54, grade: 'C' }
];

const DEFAULT_CO_SCHOLASTIC = [
  { subject: 'G.K', grade: 'A' },
  { subject: 'V.E', grade: 'B' },
  { subject: 'ENGLISH DICTATION', grade: 'D' },
  { subject: 'TAMIL DICTATION', grade: 'D' },
  { subject: 'EVS DICTATION', grade: 'B+' }
];

// Helper to calculate grade from marks
export const calculateGrade = (mark) => {
  const num = parseFloat(mark);
  if (isNaN(num)) return '';
  if (num >= 90) return 'A+';
  if (num >= 80) return 'A';
  if (num >= 70) return 'B+';
  if (num >= 60) return 'B';
  if (num >= 50) return 'C';
  return 'D';
};

// GET /api/progress-cards
// Returns students matching class/section/year filter, joined with their progress card if saved
export const getProgressCards = async (req, res) => {
  try {
    const { academicYear, currentClass, section, search } = req.query;

    const whereClause = { studentStatus: { $ne: 'Inactive' } };

    if (academicYear && academicYear.trim()) {
      whereClause.academicYear = academicYear.trim();
    }
    if (currentClass && currentClass.trim()) {
      whereClause.currentClass = currentClass.trim();
    }
    if (section && section.trim()) {
      whereClause.section = section.trim();
    }
    if (search && search.trim()) {
      const q = search.trim();
      whereClause.$or = [
        { studentName: { $regex: q, $options: 'i' } },
        { admissionNumber: { $regex: q, $options: 'i' } }
      ];
    }

    const students = await Student.find(whereClause)
      .select('_id admissionNumber studentName currentClass section academicYear studentStatus photoUrl passport_photo address city state pincode fatherName motherName gender dateOfBirth fatherPhone motherPhone whatsappNumber bloodGroup')
      .sort({ studentName: 1 })
      .lean();

    const targetTerm = req.query.term || 'TERM - II';
    const targetYear = academicYear || '2025 - 2026';

    const studentIds = students.map(s => s._id);
    const existingCards = await ProgressCard.find({
      studentId: { $in: studentIds },
      academicYear: targetYear,
      term: targetTerm
    }).lean();

    const cardMap = new Map();
    existingCards.forEach(c => cardMap.set(c.studentId.toString(), c));

    const result = students.map(s => {
      const photo = s.passport_photo || s.photoUrl || '';
      const card = cardMap.get(s._id.toString());

      return {
        _id: s._id,
        admissionNumber: s.admissionNumber,
        studentName: s.studentName,
        currentClass: s.currentClass,
        section: s.section || 'A',
        academicYear: s.academicYear || targetYear,
        term: targetTerm,
        studentStatus: s.studentStatus || 'Active',
        photoUrl: photo,
        passport_photo: photo,
        address: s.address || [s.city, s.state, s.pincode].filter(Boolean).join(', '),
        dateOfBirth: s.dateOfBirth || '',
        dob: s.dateOfBirth || '',
        gender: s.gender || '',
        fatherName: s.fatherName || '',
        motherName: s.motherName || '',
        mobileNo: s.fatherPhone || s.phone || s.motherPhone || s.whatsappNumber || '',
        bloodGroup: card?.healthStatus?.bloodGroup || s.bloodGroup || '',
        progressCardId: card?._id || null,
        attendance: card?.attendance || {
          totalWorkingDays: 58,
          studentAttendance: 54
        },
        healthStatus: {
          bloodGroup: card?.healthStatus?.bloodGroup || s.bloodGroup || '',
          height: card?.healthStatus?.height || '',
          weight: card?.healthStatus?.weight || '',
          dentalHygiene: card?.healthStatus?.dentalHygiene || ''
        },
        scholastic: card?.scholastic || DEFAULT_SCHOLASTIC,
        totalMarks: card?.totalMarks ?? 448,
        overallGrade: card?.overallGrade || 'B',
        coScholastic: card?.coScholastic || DEFAULT_CO_SCHOLASTIC,
        selfAwareness: card?.selfAwareness || {
          goals: '',
          strengths: '',
          interestsHobbies: '',
          responsibilitiesAchievements: ''
        },
        teacherRemarks: card?.teacherRemarks || ''
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching progress cards:', error);
    res.status(500).json({ error: 'Failed to fetch progress cards' });
  }
};

// GET /api/progress-cards/:studentId
export const getStudentProgressCard = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { academicYear = '2025 - 2026', term = 'TERM - II' } = req.query;

    const student = await Student.findById(studentId).lean();
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const card = await ProgressCard.findOne({
      studentId,
      academicYear,
      term
    }).lean();

    const photo = student.passport_photo || student.photoUrl || '';

    res.json({
      _id: student._id,
      admissionNumber: student.admissionNumber,
      studentName: student.studentName,
      currentClass: student.currentClass,
      section: student.section || 'A',
      academicYear,
      term,
      photoUrl: photo,
      passport_photo: photo,
      address: student.address || [student.city, student.state, student.pincode].filter(Boolean).join(', '),
      dateOfBirth: student.dateOfBirth || '',
      dob: student.dateOfBirth || '',
      gender: student.gender || '',
      fatherName: student.fatherName || '',
      motherName: student.motherName || '',
      mobileNo: student.fatherPhone || student.motherPhone || student.whatsappNumber || '',
      progressCardId: card?._id || null,
      attendance: card?.attendance || {
        totalWorkingDays: 58,
        studentAttendance: 54
      },
      healthStatus: {
        bloodGroup: card?.healthStatus?.bloodGroup || student.bloodGroup || '',
        height: card?.healthStatus?.height || '',
        weight: card?.healthStatus?.weight || '',
        dentalHygiene: card?.healthStatus?.dentalHygiene || ''
      },
      scholastic: card?.scholastic || DEFAULT_SCHOLASTIC,
      totalMarks: card?.totalMarks ?? 448,
      overallGrade: card?.overallGrade || 'B',
      coScholastic: card?.coScholastic || DEFAULT_CO_SCHOLASTIC,
      selfAwareness: card?.selfAwareness || {
        goals: '',
        strengths: '',
        interestsHobbies: '',
        responsibilitiesAchievements: ''
      },
      teacherRemarks: card?.teacherRemarks || ''
    });
  } catch (error) {
    console.error('Error fetching student progress card:', error);
    res.status(500).json({ error: 'Failed to fetch student progress card' });
  }
};

// POST /api/progress-cards/save
// Save or update marks/grades for a student
export const saveProgressCard = async (req, res) => {
  try {
    const {
      studentId,
      academicYear = '2025 - 2026',
      term = 'TERM - II',
      currentClass,
      section,
      attendance,
      healthStatus,
      scholastic,
      totalMarks,
      overallGrade,
      coScholastic,
      selfAwareness,
      teacherRemarks
    } = req.body;

    if (!studentId) {
      return res.status(400).json({ error: 'Student ID is required' });
    }

    const updatedCard = await ProgressCard.findOneAndUpdate(
      { studentId, academicYear, term },
      {
        studentId,
        academicYear,
        term,
        currentClass,
        section,
        attendance,
        healthStatus,
        scholastic,
        totalMarks,
        overallGrade,
        coScholastic,
        selfAwareness,
        teacherRemarks
      },
      { new: true, upsert: true }
    );

    res.json({ message: 'Progress card saved successfully', card: updatedCard });
  } catch (error) {
    console.error('Error saving progress card:', error);
    res.status(500).json({ error: 'Failed to save progress card' });
  }
};
