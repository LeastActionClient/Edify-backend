import {
  Student,
  StudentEnrollment,
  AcademicYear,
  ProgressCard,
  ProgressCardSubject,
  ProgressCardExam
} from '../models/index.js';

const DEFAULT_EXAM_NAMES = ['TERM - I', 'TERM - II', 'TERM - III', 'ANNUAL'];

const escapeRegex = (str = '') => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Helper to calculate grade from marks
export const calculateGrade = (mark, maxMarks = 100) => {
  if (mark === '' || mark === null || mark === undefined) return '';
  const num = parseFloat(mark);
  if (isNaN(num)) return '';
  const max = parseFloat(maxMarks) || 100;
  const pct = (num / max) * 100;
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B+';
  if (pct >= 60) return 'B';
  if (pct >= 50) return 'C';
  return 'D';
};

const GRADE_TO_SCORE = {
  'A+': 95,
  'A': 85,
  'B+': 75,
  'B': 65,
  'C': 55,
  'D': 40
};

const computeScholasticTotals = (scholastic = []) => {
  const numericEntries = scholastic.filter(
    (item) => item.mark !== '' && item.mark !== null && item.mark !== undefined && !isNaN(parseFloat(item.mark))
  );

  if (numericEntries.length > 0) {
    const rawTotal = numericEntries.reduce((sum, item) => sum + parseFloat(item.mark), 0);
    const totalMarks = Number.isInteger(rawTotal) ? rawTotal : Number(rawTotal.toFixed(2));
    const totalMax = numericEntries.reduce((sum, item) => sum + (parseFloat(item.maxMarks) || 100), 0);
    const overallGrade = calculateGrade(totalMarks, totalMax || 100);
    return { totalMarks, overallGrade };
  }

  const gradeOnlyEntries = scholastic.filter(
    (item) => item.grade && GRADE_TO_SCORE[String(item.grade).trim().toUpperCase()] !== undefined
  );

  if (gradeOnlyEntries.length > 0) {
    const avgScore =
      gradeOnlyEntries.reduce(
        (sum, item) => sum + GRADE_TO_SCORE[String(item.grade).trim().toUpperCase()],
        0
      ) / gradeOnlyEntries.length;
    return { totalMarks: '', overallGrade: calculateGrade(avgScore, 100) };
  }

  return { totalMarks: '', overallGrade: '' };
};

const resolveTargetAcademicYear = async (requestedYear) => {
  if (requestedYear && requestedYear.trim()) {
    return requestedYear.trim();
  }
  const activeYear = await AcademicYear.findOne({ status: 'Active' })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();
  if (activeYear?.year) return activeYear.year;

  const latestYear = await AcademicYear.findOne().sort({ year: -1 }).lean();
  return latestYear?.year || '2025 - 2026';
};

const findSavedScore = (savedList = [], subj) => {
  if (!Array.isArray(savedList) || savedList.length === 0) return null;
  const subjIdStr = subj._id ? subj._id.toString() : null;
  if (subjIdStr) {
    const byId = savedList.find((item) => item.subjectId && item.subjectId.toString() === subjIdStr);
    if (byId) return byId;
  }
  const targetName = String(subj.name || '').trim().toLowerCase();
  return savedList.find((item) => String(item.subject || '').trim().toLowerCase() === targetName) || null;
};

const mergeCardWithSubjects = (student, effectiveClass, effectiveSection, targetYear, targetTerm, card, classSubjects = []) => {
  const photo = student.passport_photo || student.photoUrl || '';

  const allScholasticSubjects = classSubjects.filter((s) => s.category === 'scholastic');
  const activeScholasticSubjects = allScholasticSubjects.filter((s) => s.isActive);
  const allCoScholasticSubjects = classSubjects.filter((s) => s.category === 'coScholastic');
  const activeCoScholasticSubjects = allCoScholasticSubjects.filter((s) => s.isActive);

  let scholastic = [];
  if (allScholasticSubjects.length > 0) {
    scholastic = activeScholasticSubjects.map((subj) => {
      const saved = findSavedScore(card?.scholastic, subj);
      const mark = saved?.mark !== undefined && saved?.mark !== null ? saved.mark : '';
      const grade = saved?.grade || (mark !== '' ? calculateGrade(mark, subj.maxMarks || 100) : '');
      return {
        subjectId: subj._id,
        subject: subj.name,
        maxMarks: subj.maxMarks || 100,
        mark,
        grade
      };
    });
  } else if (card?.scholastic?.length > 0) {
    scholastic = card.scholastic;
  }

  let coScholastic = [];
  if (allCoScholasticSubjects.length > 0) {
    coScholastic = activeCoScholasticSubjects.map((subj) => {
      const saved = findSavedScore(card?.coScholastic, subj);
      return {
        subjectId: subj._id,
        subject: subj.name,
        grade: saved?.grade || ''
      };
    });
  } else if (card?.coScholastic?.length > 0) {
    coScholastic = card.coScholastic;
  }

  const computedTotals = computeScholasticTotals(scholastic);
  const totalMarks =
    card?.totalMarks !== undefined && card?.totalMarks !== '' && card?.totalMarks !== null
      ? card.totalMarks
      : computedTotals.totalMarks !== ''
        ? computedTotals.totalMarks
        : '';
  const overallGrade =
    card?.overallGrade !== undefined && card?.overallGrade !== '' && card?.overallGrade !== null
      ? card.overallGrade
      : computedTotals.overallGrade || '';

  return {
    _id: student._id,
    admissionNumber: student.admissionNumber,
    studentName: student.studentName,
    currentClass: effectiveClass,
    section: effectiveSection || 'A',
    academicYear: targetYear,
    term: targetTerm,
    studentStatus: student.studentStatus || 'Active',
    photoUrl: photo,
    passport_photo: photo,
    aadId: student.aadhaarNumber || '',
    aadhaarNumber: student.aadhaarNumber || '',
    address: student.address || [student.city, student.state, student.pincode].filter(Boolean).join(', '),
    dateOfBirth: student.dateOfBirth || '',
    dob: student.dateOfBirth || '',
    gender: student.gender || '',
    fatherName: student.fatherName || '',
    motherName: student.motherName || '',
    mobileNo: student.fatherPhone || student.motherPhone || student.whatsappNumber || '',
    bloodGroup: card?.healthStatus?.bloodGroup || student.bloodGroup || '',
    progressCardId: card?._id || null,
    hasSavedCard: Boolean(card),
    attendance: {
      totalWorkingDays: card?.attendance?.totalWorkingDays ?? 0,
      studentAttendance: card?.attendance?.studentAttendance ?? 0
    },
    healthStatus: {
      bloodGroup: card?.healthStatus?.bloodGroup || student.bloodGroup || '',
      height: card?.healthStatus?.height || '',
      weight: card?.healthStatus?.weight || '',
      dentalHygiene: card?.healthStatus?.dentalHygiene || ''
    },
    scholastic,
    totalMarks,
    overallGrade,
    coScholastic,
    selfAwareness: card?.selfAwareness || {
      goals: '',
      strengths: '',
      interestsHobbies: '',
      responsibilitiesAchievements: ''
    },
    teacherRemarks: card?.teacherRemarks || ''
  };
};

// ================= SUBJECT MANAGEMENT =================

// GET /api/progress-cards/subjects
export const getSubjects = async (req, res) => {
  try {
    const { academicYear, className, category, includeInactive } = req.query;
    const targetYear = await resolveTargetAcademicYear(academicYear);

    const filter = { academicYear: targetYear };
    if (className && className.trim()) {
      filter.className = className.trim();
    }
    if (category && ['scholastic', 'coScholastic'].includes(category)) {
      filter.category = category;
    }
    if (includeInactive !== 'true') {
      filter.isActive = true;
    }

    const subjects = await ProgressCardSubject.find(filter)
      .sort({ category: 1, displayOrder: 1, createdAt: 1 })
      .lean();

    res.json(subjects);
  } catch (error) {
    console.error('Error fetching progress card subjects:', error);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
};

// POST /api/progress-cards/subjects
// Add or select single or multiple subjects for a class & academic year
export const createOrSelectSubjects = async (req, res) => {
  try {
    const {
      academicYear,
      className,
      category = 'scholastic',
      name,
      maxMarks = 100,
      subjects // optional array of { name, maxMarks }
    } = req.body;

    const targetYear = await resolveTargetAcademicYear(academicYear);
    if (!className || !className.trim()) {
      return res.status(400).json({ error: 'Class is required to assign subjects' });
    }
    const targetClass = className.trim();

    if (!['scholastic', 'coScholastic'].includes(category)) {
      return res.status(400).json({ error: 'Invalid subject category' });
    }

    const itemsToProcess = Array.isArray(subjects) && subjects.length > 0
      ? subjects
      : name && name.trim()
        ? [{ name: name.trim(), maxMarks }]
        : [];

    if (itemsToProcess.length === 0) {
      return res.status(400).json({ error: 'Subject name is required' });
    }

    const existingLast = await ProgressCardSubject.findOne({
      academicYear: targetYear,
      className: targetClass,
      category
    })
      .sort({ displayOrder: -1 })
      .lean();

    let nextOrder = (existingLast?.displayOrder ?? -1) + 1;
    const createdOrActivated = [];
    const skipped = [];

    for (const item of itemsToProcess) {
      const trimmedName = String(item.name || '').trim();
      if (!trimmedName) continue;

      const parsedMaxMarks = category === 'scholastic' ? Math.max(1, Number(item.maxMarks) || 100) : 100;

      const existing = await ProgressCardSubject.findOne({
        academicYear: targetYear,
        className: targetClass,
        category,
        name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') }
      });

      if (existing) {
        if (!existing.isActive) {
          existing.isActive = true;
          existing.name = trimmedName;
          existing.maxMarks = parsedMaxMarks;
          await existing.save();
          createdOrActivated.push(existing);
        } else {
          skipped.push(existing.name);
        }
      } else {
        const created = await ProgressCardSubject.create({
          academicYear: targetYear,
          className: targetClass,
          category,
          name: trimmedName,
          maxMarks: parsedMaxMarks,
          displayOrder: nextOrder++,
          isActive: true
        });
        createdOrActivated.push(created);
      }
    }

    if (itemsToProcess.length === 1 && createdOrActivated.length === 0 && skipped.length > 0) {
      return res.status(400).json({ error: `Subject "${skipped[0]}" already exists for Class ${targetClass} (${targetYear})` });
    }

    res.status(201).json({
      message: createdOrActivated.length > 0
        ? `${createdOrActivated.length} subject(s) added/activated for Class ${targetClass}`
        : 'Selected subjects are already active',
      subjects: createdOrActivated,
      skipped
    });
  } catch (error) {
    console.error('Error creating/selecting subjects:', error);
    res.status(500).json({ error: error.message || 'Failed to save subjects' });
  }
};

// PUT /api/progress-cards/subjects/:subjectId
export const updateSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { name, maxMarks, displayOrder, isActive } = req.body;

    const subjectDoc = await ProgressCardSubject.findById(subjectId);
    if (!subjectDoc) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const oldName = subjectDoc.name;
    const trimmedNewName = name !== undefined ? String(name).trim() : oldName;

    if (!trimmedNewName) {
      return res.status(400).json({ error: 'Subject name cannot be empty' });
    }

    if (trimmedNewName.toLowerCase() !== oldName.toLowerCase()) {
      const duplicate = await ProgressCardSubject.findOne({
        _id: { $ne: subjectId },
        academicYear: subjectDoc.academicYear,
        className: subjectDoc.className,
        category: subjectDoc.category,
        name: { $regex: new RegExp(`^${escapeRegex(trimmedNewName)}$`, 'i') }
      });
      if (duplicate) {
        return res.status(400).json({ error: `Subject "${trimmedNewName}" already exists in this class` });
      }
    }

    const parsedMaxMarks = maxMarks !== undefined ? Math.max(1, Number(maxMarks) || 100) : subjectDoc.maxMarks;

    subjectDoc.name = trimmedNewName;
    if (subjectDoc.category === 'scholastic') {
      subjectDoc.maxMarks = parsedMaxMarks;
    }
    if (displayOrder !== undefined && !isNaN(Number(displayOrder))) {
      subjectDoc.displayOrder = Number(displayOrder);
    }
    if (typeof isActive === 'boolean') {
      subjectDoc.isActive = isActive;
    }

    await subjectDoc.save();

    // Propagate rename / maxMarks update consistently to cards in the SAME academicYear & className
    // without touching historical cards from other years/classes
    if (trimmedNewName !== oldName || maxMarks !== undefined) {
      const arrayField = subjectDoc.category === 'scholastic' ? 'scholastic' : 'coScholastic';
      const cards = await ProgressCard.find({
        academicYear: subjectDoc.academicYear,
        currentClass: subjectDoc.className
      });

      for (const card of cards) {
        let modified = false;
        const list = card[arrayField] || [];
        for (const entry of list) {
          const matchesId = entry.subjectId && entry.subjectId.toString() === subjectId;
          const matchesName = String(entry.subject || '').trim().toLowerCase() === oldName.toLowerCase();
          if (matchesId || matchesName) {
            entry.subjectId = subjectDoc._id;
            entry.subject = trimmedNewName;
            if (subjectDoc.category === 'scholastic') {
              entry.maxMarks = parsedMaxMarks;
            }
            modified = true;
          }
        }
        if (modified) {
          if (subjectDoc.category === 'scholastic') {
            const totals = computeScholasticTotals(card.scholastic);
            card.totalMarks = totals.totalMarks;
            card.overallGrade = totals.overallGrade;
          }
          await card.save();
        }
      }
    }

    res.json({ message: 'Subject updated successfully', subject: subjectDoc });
  } catch (error) {
    console.error('Error updating subject:', error);
    res.status(500).json({ error: 'Failed to update subject' });
  }
};

// DELETE /api/progress-cards/subjects/:subjectId
// Preserves historical report card data: archives (isActive: false) if any ProgressCard has saved data for it
export const deleteSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const subjectDoc = await ProgressCardSubject.findById(subjectId);
    if (!subjectDoc) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const arrayField = subjectDoc.category === 'scholastic' ? 'scholastic' : 'coScholastic';
    const cardsInClass = await ProgressCard.find({
      academicYear: subjectDoc.academicYear,
      currentClass: subjectDoc.className
    }).lean();

    const hasHistoricalScores = cardsInClass.some((card) =>
      (card[arrayField] || []).some((entry) => {
        const matchesId = entry.subjectId && entry.subjectId.toString() === subjectId;
        const matchesName = String(entry.subject || '').trim().toLowerCase() === subjectDoc.name.toLowerCase();
        if (!matchesId && !matchesName) return false;
        return (entry.mark !== '' && entry.mark !== null && entry.mark !== undefined) || Boolean(entry.grade);
      })
    );

    if (hasHistoricalScores) {
      subjectDoc.isActive = false;
      await subjectDoc.save();
      return res.json({
        message: 'Subject deactivated from active class list while preserving existing student report card data.',
        archived: true,
        subject: subjectDoc
      });
    }

    await ProgressCardSubject.findByIdAndDelete(subjectId);
    res.json({
      message: 'Subject removed successfully.',
      archived: false
    });
  } catch (error) {
    console.error('Error removing subject:', error);
    res.status(500).json({ error: 'Failed to remove subject' });
  }
};

// ================= PROGRESS CARDS DATA =================

// GET /api/progress-cards
export const getProgressCards = async (req, res) => {
  try {
    const { academicYear, currentClass, section, search, term } = req.query;
    const targetYear = await resolveTargetAcademicYear(academicYear);
    const targetTerm = (term && term.trim()) || 'TERM - II';

    // 1. Find students enrolled in targetYear (supports promoted/historical years via StudentEnrollment)
    const enrollmentFilter = { academicYear: targetYear };
    if (currentClass && currentClass.trim()) {
      enrollmentFilter.className = currentClass.trim();
    }
    if (section && section.trim()) {
      enrollmentFilter.sectionName = section.trim();
    }

    const enrollments = await StudentEnrollment.find(enrollmentFilter).lean();
    const enrollmentMap = new Map();
    enrollments.forEach((e) => {
      enrollmentMap.set(e.studentId.toString(), e);
    });

    // 2. Also find students directly matching targetYear on Student doc (fallback if no StudentEnrollment exists)
    const directStudentFilter = {
      studentStatus: { $ne: 'Inactive' },
      academicYear: targetYear
    };
    if (currentClass && currentClass.trim()) {
      directStudentFilter.currentClass = currentClass.trim();
    }
    if (section && section.trim()) {
      directStudentFilter.section = section.trim();
    }

    const enrolledStudentIds = enrollments.map((e) => e.studentId);

    const studentQuery = enrolledStudentIds.length > 0
      ? {
          studentStatus: { $ne: 'Inactive' },
          $or: [
            { _id: { $in: enrolledStudentIds } },
            directStudentFilter
          ]
        }
      : directStudentFilter;

    if (search && search.trim()) {
      const q = search.trim();
      const searchCond = {
        $or: [
          { studentName: { $regex: q, $options: 'i' } },
          { admissionNumber: { $regex: q, $options: 'i' } }
        ]
      };
      if (studentQuery.$or) {
        studentQuery.$and = [{ $or: studentQuery.$or }, searchCond];
        delete studentQuery.$or;
      } else {
        Object.assign(studentQuery, searchCond);
      }
    }

    const students = await Student.find(studentQuery)
      .select(
        '_id admissionNumber studentName currentClass section academicYear studentStatus photoUrl passport_photo address city state pincode fatherName motherName gender dateOfBirth fatherPhone motherPhone whatsappNumber bloodGroup aadhaarNumber'
      )
      .sort({ studentName: 1 })
      .lean();

    // Ensure class/section filter is strictly respected using effective class/section for targetYear
    const filteredStudents = students.filter((s) => {
      const enr = enrollmentMap.get(s._id.toString());
      const effClass = enr?.className || s.currentClass;
      const effSec = enr?.sectionName || s.section || 'A';
      if (currentClass && currentClass.trim() && effClass !== currentClass.trim()) return false;
      if (section && section.trim() && effSec !== section.trim()) return false;
      return true;
    });

    const studentIds = filteredStudents.map((s) => s._id);
    const classNames = [...new Set(
      filteredStudents.map((s) => enrollmentMap.get(s._id.toString())?.className || s.currentClass).filter(Boolean)
    )];

    const [existingCards, subjects] = await Promise.all([
      studentIds.length > 0
        ? ProgressCard.find({
            studentId: { $in: studentIds },
            academicYear: targetYear,
            term: targetTerm
          }).lean()
        : [],
      classNames.length > 0
        ? ProgressCardSubject.find({
            academicYear: targetYear,
            className: { $in: classNames }
          })
            .sort({ displayOrder: 1, createdAt: 1 })
            .lean()
        : []
    ]);

    const cardMap = new Map();
    existingCards.forEach((c) => cardMap.set(c.studentId.toString(), c));

    const subjectsByClass = new Map();
    subjects.forEach((subj) => {
      if (!subjectsByClass.has(subj.className)) {
        subjectsByClass.set(subj.className, []);
      }
      subjectsByClass.get(subj.className).push(subj);
    });

    const result = filteredStudents.map((s) => {
      const enr = enrollmentMap.get(s._id.toString());
      const effClass = enr?.className || s.currentClass;
      const effSec = enr?.sectionName || s.section || 'A';
      const card = cardMap.get(s._id.toString());
      const classSubjects = subjectsByClass.get(effClass) || [];
      return mergeCardWithSubjects(s, effClass, effSec, targetYear, targetTerm, card, classSubjects);
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
    const { academicYear, term = 'TERM - II' } = req.query;
    const targetYear = await resolveTargetAcademicYear(academicYear);
    const targetTerm = (term && term.trim()) || 'TERM - II';

    const student = await Student.findById(studentId).lean();
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const enrollment = await StudentEnrollment.findOne({
      studentId,
      academicYear: targetYear
    }).lean();

    const effClass = enrollment?.className || student.currentClass;
    const effSec = enrollment?.sectionName || student.section || 'A';

    const [card, classSubjects] = await Promise.all([
      ProgressCard.findOne({
        studentId,
        academicYear: targetYear,
        term: targetTerm
      }).lean(),
      ProgressCardSubject.find({
        academicYear: targetYear,
        className: effClass
      })
        .sort({ displayOrder: 1, createdAt: 1 })
        .lean()
    ]);

    res.json(mergeCardWithSubjects(student, effClass, effSec, targetYear, targetTerm, card, classSubjects));
  } catch (error) {
    console.error('Error fetching student progress card:', error);
    res.status(500).json({ error: 'Failed to fetch student progress card' });
  }
};

// POST /api/progress-cards/save
// Save or update marks/grades/attendance/health for a single student
export const saveProgressCard = async (req, res) => {
  try {
    const {
      studentId,
      academicYear,
      term = 'TERM - II',
      currentClass,
      section,
      attendance,
      healthStatus,
      scholastic = [],
      totalMarks,
      overallGrade,
      coScholastic = [],
      selfAwareness,
      teacherRemarks
    } = req.body;

    if (!studentId) {
      return res.status(400).json({ error: 'Student ID is required' });
    }

    const targetYear = await resolveTargetAcademicYear(academicYear);
    const targetTerm = (term && term.trim()) || 'TERM - II';

    const existing = await ProgressCard.findOne({
      studentId,
      academicYear: targetYear,
      term: targetTerm
    }).lean();

    // Preserve any historical/inactive subject scores already saved in DB
    const mergePreservingInactive = (incoming = [], prev = [], isScholastic = true) => {
      const incomingIds = new Set(incoming.map((i) => i.subjectId?.toString()).filter(Boolean));
      const incomingNames = new Set(incoming.map((i) => String(i.subject || '').trim().toLowerCase()));

      const preservedHistorical = (prev || []).filter((oldItem) => {
        const idMatch = oldItem.subjectId && incomingIds.has(oldItem.subjectId.toString());
        const nameMatch = incomingNames.has(String(oldItem.subject || '').trim().toLowerCase());
        if (idMatch || nameMatch) return false;
        return isScholastic
          ? (oldItem.mark !== '' && oldItem.mark !== null && oldItem.mark !== undefined) || Boolean(oldItem.grade)
          : Boolean(oldItem.grade);
      });

      return [...incoming, ...preservedHistorical];
    };

    const mergedScholastic = mergePreservingInactive(scholastic, existing?.scholastic, true);
    const mergedCoScholastic = mergePreservingInactive(coScholastic, existing?.coScholastic, false);
    const computedTotals = computeScholasticTotals(scholastic);

    const updatedCard = await ProgressCard.findOneAndUpdate(
      { studentId, academicYear: targetYear, term: targetTerm },
      {
        studentId,
        academicYear: targetYear,
        term: targetTerm,
        currentClass,
        section,
        attendance,
        healthStatus,
        scholastic: mergedScholastic,
        totalMarks: totalMarks !== undefined && totalMarks !== '' ? totalMarks : computedTotals.totalMarks,
        overallGrade: overallGrade || computedTotals.overallGrade,
        coScholastic: mergedCoScholastic,
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

// POST /api/progress-cards/bulk-subject-save
// Save a selected subject's mark/grade separately for each student in the list
export const saveSubjectGradesForStudents = async (req, res) => {
  try {
    const {
      academicYear,
      term = 'TERM - II',
      category = 'scholastic',
      subjectId,
      subjectName,
      maxMarks = 100,
      entries = []
    } = req.body;

    const targetYear = await resolveTargetAcademicYear(academicYear);
    const targetTerm = (term && term.trim()) || 'TERM - II';

    if (!subjectName || !subjectName.trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'No student grade entries provided' });
    }

    const cleanSubjectName = subjectName.trim();
    const parsedMaxMarks = Math.max(1, Number(maxMarks) || 100);
    let updatedCount = 0;

    for (const entry of entries) {
      if (!entry.studentId) continue;

      let card = await ProgressCard.findOne({
        studentId: entry.studentId,
        academicYear: targetYear,
        term: targetTerm
      });

      if (!card) {
        const studentDoc = await Student.findById(entry.studentId).select('currentClass section bloodGroup').lean();
        if (!studentDoc) continue;
        card = new ProgressCard({
          studentId: entry.studentId,
          academicYear: targetYear,
          term: targetTerm,
          currentClass: entry.currentClass || studentDoc.currentClass,
          section: entry.section || studentDoc.section || 'A',
          healthStatus: {
            bloodGroup: studentDoc.bloodGroup || ''
          }
        });
      }

      if (category === 'scholastic') {
        const markVal = entry.mark !== undefined && entry.mark !== null ? entry.mark : '';
        const gradeVal =
          entry.grade && String(entry.grade).trim()
            ? String(entry.grade).trim().toUpperCase()
            : markVal !== ''
              ? calculateGrade(markVal, parsedMaxMarks)
              : '';

        const idx = card.scholastic.findIndex(
          (item) =>
            (subjectId && item.subjectId && item.subjectId.toString() === subjectId.toString()) ||
            String(item.subject || '').trim().toLowerCase() === cleanSubjectName.toLowerCase()
        );

        if (idx >= 0) {
          card.scholastic[idx].subjectId = subjectId || card.scholastic[idx].subjectId;
          card.scholastic[idx].subject = cleanSubjectName;
          card.scholastic[idx].maxMarks = parsedMaxMarks;
          card.scholastic[idx].mark = markVal;
          card.scholastic[idx].grade = gradeVal;
        } else {
          card.scholastic.push({
            subjectId: subjectId || undefined,
            subject: cleanSubjectName,
            maxMarks: parsedMaxMarks,
            mark: markVal,
            grade: gradeVal
          });
        }

        // Recalculate totals using active subjects for this student's class if configured
        const activeSubjs = await ProgressCardSubject.find({
          academicYear: targetYear,
          className: card.currentClass,
          category: 'scholastic',
          isActive: true
        }).lean();

        const activeRows = activeSubjs.length > 0
          ? activeSubjs.map((s) => findSavedScore(card.scholastic, s)).filter(Boolean)
          : card.scholastic;

        const totals = computeScholasticTotals(activeRows);
        card.totalMarks = totals.totalMarks;
        card.overallGrade = totals.overallGrade;
      } else {
        const gradeVal = entry.grade ? String(entry.grade).trim().toUpperCase() : '';
        const idx = card.coScholastic.findIndex(
          (item) =>
            (subjectId && item.subjectId && item.subjectId.toString() === subjectId.toString()) ||
            String(item.subject || '').trim().toLowerCase() === cleanSubjectName.toLowerCase()
        );

        if (idx >= 0) {
          card.coScholastic[idx].subjectId = subjectId || card.coScholastic[idx].subjectId;
          card.coScholastic[idx].subject = cleanSubjectName;
          card.coScholastic[idx].grade = gradeVal;
        } else {
          card.coScholastic.push({
            subjectId: subjectId || undefined,
            subject: cleanSubjectName,
            grade: gradeVal
          });
        }
      }

      await card.save();
      updatedCount += 1;
    }

    res.json({
      message: `Saved ${cleanSubjectName} grades for ${updatedCount} student(s)`,
      updatedCount
    });
  } catch (error) {
    console.error('Error saving subject grades:', error);
    res.status(500).json({ error: 'Failed to save subject grades' });
  }
};

// ================= DYNAMIC EXAM NAME MANAGEMENT =================

const ensureDefaultExamsForYear = async (academicYear) => {
  const count = await ProgressCardExam.countDocuments({ academicYear });
  if (count === 0) {
    const docs = DEFAULT_EXAM_NAMES.map((name, idx) => ({
      academicYear,
      className: 'ALL',
      name,
      displayOrder: idx,
      isActive: true
    }));
    await ProgressCardExam.insertMany(docs, { ordered: false }).catch(() => {});
  }
};

// GET /api/progress-cards/exams
export const getExams = async (req, res) => {
  try {
    const { academicYear, className, includeInactive } = req.query;
    const targetYear = await resolveTargetAcademicYear(academicYear);

    await ensureDefaultExamsForYear(targetYear);

    const filter = { academicYear: targetYear };
    if (className && className.trim() && className.trim() !== 'ALL') {
      filter.className = { $in: ['ALL', className.trim()] };
    }
    if (includeInactive !== 'true') {
      filter.isActive = true;
    }

    const exams = await ProgressCardExam.find(filter)
      .sort({ displayOrder: 1, createdAt: 1 })
      .lean();

    res.json(exams);
  } catch (error) {
    console.error('Error fetching progress card exams:', error);
    res.status(500).json({ error: 'Failed to fetch exams' });
  }
};

// POST /api/progress-cards/exams
export const createExam = async (req, res) => {
  try {
    const { academicYear, className = 'ALL', name } = req.body;
    const targetYear = await resolveTargetAcademicYear(academicYear);
    const trimmedName = String(name || '').trim();

    if (!trimmedName) {
      return res.status(400).json({ error: 'Exam name is required' });
    }

    await ensureDefaultExamsForYear(targetYear);

    const targetClass = className && String(className).trim() ? String(className).trim() : 'ALL';
    const nameRegex = new RegExp(`^${escapeRegex(trimmedName)}$`, 'i');

    const conflictFilter = {
      academicYear: targetYear,
      name: { $regex: nameRegex },
      className: targetClass === 'ALL' ? 'ALL' : { $in: ['ALL', targetClass] }
    };

    const existing = await ProgressCardExam.findOne(conflictFilter);
    if (existing) {
      if (!existing.isActive && existing.className === targetClass) {
        existing.isActive = true;
        existing.name = trimmedName;
        await existing.save();
        return res.status(201).json({
          message: `Exam "${trimmedName}" restored successfully`,
          exam: existing
        });
      }
      return res.status(400).json({
        error: `Exam "${existing.name}" already exists for ${existing.className === 'ALL' ? 'All Classes' : `Class ${existing.className}`} (${targetYear})`
      });
    }

    const lastExam = await ProgressCardExam.findOne({ academicYear: targetYear })
      .sort({ displayOrder: -1 })
      .lean();

    const exam = await ProgressCardExam.create({
      academicYear: targetYear,
      className: targetClass,
      name: trimmedName,
      displayOrder: (lastExam?.displayOrder ?? -1) + 1,
      isActive: true,
      createdBy: req.user?.id
    });

    res.status(201).json({
      message: `Exam "${trimmedName}" added successfully`,
      exam
    });
  } catch (error) {
    console.error('Error creating exam:', error);
    res.status(500).json({ error: error.message || 'Failed to create exam' });
  }
};

// PUT /api/progress-cards/exams/:examId
export const updateExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const { name, isActive } = req.body;

    const examDoc = await ProgressCardExam.findById(examId);
    if (!examDoc) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    const oldName = examDoc.name;
    const trimmedNewName = name !== undefined ? String(name).trim() : oldName;

    if (!trimmedNewName) {
      return res.status(400).json({ error: 'Exam name cannot be empty' });
    }

    if (trimmedNewName.toLowerCase() !== oldName.toLowerCase()) {
      const nameRegex = new RegExp(`^${escapeRegex(trimmedNewName)}$`, 'i');
      const duplicate = await ProgressCardExam.findOne({
        _id: { $ne: examId },
        academicYear: examDoc.academicYear,
        name: { $regex: nameRegex },
        className: examDoc.className === 'ALL' ? 'ALL' : { $in: ['ALL', examDoc.className] }
      });
      if (duplicate) {
        return res.status(400).json({
          error: `Exam "${duplicate.name}" already exists for ${duplicate.className === 'ALL' ? 'All Classes' : `Class ${duplicate.className}`} (${examDoc.academicYear})`
        });
      }
    }

    examDoc.name = trimmedNewName;
    if (typeof isActive === 'boolean') {
      examDoc.isActive = isActive;
    }
    await examDoc.save();

    // Propagate rename to matching ProgressCard records so historical grades remain linked
    if (trimmedNewName !== oldName) {
      const cardFilter = {
        academicYear: examDoc.academicYear,
        term: oldName
      };
      if (examDoc.className !== 'ALL') {
        cardFilter.currentClass = examDoc.className;
      }

      const cardsToUpdate = await ProgressCard.find(cardFilter);
      for (const card of cardsToUpdate) {
        const collision = await ProgressCard.findOne({
          _id: { $ne: card._id },
          studentId: card.studentId,
          academicYear: card.academicYear,
          term: trimmedNewName
        }).lean();

        if (!collision) {
          card.term = trimmedNewName;
          await card.save();
        }
      }
    }

    res.json({ message: 'Exam updated successfully', exam: examDoc });
  } catch (error) {
    console.error('Error updating exam:', error);
    res.status(500).json({ error: 'Failed to update exam' });
  }
};

// DELETE /api/progress-cards/exams/:examId
export const deleteExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const examDoc = await ProgressCardExam.findById(examId);
    if (!examDoc) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    const activeCount = await ProgressCardExam.countDocuments({
      academicYear: examDoc.academicYear,
      isActive: true
    });
    if (examDoc.isActive && activeCount <= 1) {
      return res.status(400).json({ error: 'At least one active exam must remain for the academic year.' });
    }

    const cardFilter = {
      academicYear: examDoc.academicYear,
      term: examDoc.name
    };
    if (examDoc.className !== 'ALL') {
      cardFilter.currentClass = examDoc.className;
    }

    const hasExistingCards = await ProgressCard.exists(cardFilter);
    if (hasExistingCards) {
      examDoc.isActive = false;
      await examDoc.save();
      return res.json({
        message: `Exam "${examDoc.name}" removed from dropdown while preserving existing student report card records.`,
        archived: true,
        exam: examDoc
      });
    }

    await ProgressCardExam.findByIdAndDelete(examId);
    res.json({
      message: `Exam "${examDoc.name}" deleted successfully.`,
      archived: false
    });
  } catch (error) {
    console.error('Error deleting exam:', error);
    res.status(500).json({ error: 'Failed to delete exam' });
  }
};
