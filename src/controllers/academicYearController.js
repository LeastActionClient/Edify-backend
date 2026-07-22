import { AcademicYear, StudentEnrollment } from '../models/index.js';

const validateYearFormat = (year) => {
  const yearRegex = /^(\d{4})[–-](\d{4})$/;
  const match = year.match(yearRegex);
  if (!match) {
    return 'Academic Year format must be YYYY–YYYY (e.g. 2028–2029).';
  }
  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  if (end !== start + 1) {
    return 'The ending year must always equal the starting year + 1.';
  }
  return null;
};

export const getAcademicYears = async (req, res) => {
  try {
    const years = await AcademicYear.find()
      .select('year status createdAt updatedAt')
      .sort({ year: -1 })
      .lean();
    res.json(years);
  } catch (error) {
    console.error('Error fetching academic years:', error);
    res.status(500).json({ error: 'Error fetching academic years' });
  }
};

export const getActiveAcademicYear = async (req, res) => {
  try {
    const activeYear = await AcademicYear.findOne({ status: 'Active' })
      .sort({ updatedAt: -1, createdAt: -1 })
      .select('year status createdAt updatedAt')
      .lean();
    if (!activeYear) {
      return res.status(404).json({ error: 'No active academic year found' });
    }
    res.json(activeYear);
  } catch (error) {
    console.error('Error fetching active academic year:', error);
    res.status(500).json({ error: 'Error fetching active academic year' });
  }
};

export const createAcademicYear = async (req, res) => {
  try {
    const { year, status } = req.body;

    if (!year) {
      return res.status(400).json({ error: 'Academic Year is required' });
    }

    const formatError = validateYearFormat(year);
    if (formatError) {
      return res.status(400).json({ error: formatError });
    }

    // Normalize separator to standard en-dash U+2013 or hyphen. Let's keep what they typed but replace standard hyphen with en-dash if we want YYYY–YYYY exactly
    const normalizedYear = year.trim().replace('-', '–');

    // Duplicate check
    const existing = await AcademicYear.findOne({ year: normalizedYear });
    if (existing) {
      return res.status(400).json({ error: `Academic Year ${normalizedYear} already exists.` });
    }

    const proposedStatus = status || 'Active';

    if (proposedStatus === 'Active') {
      const activeExists = await AcademicYear.findOne({ status: 'Active' });
      if (activeExists) {
        return res.status(400).json({ error: `Another Academic Year (${activeExists.year}) is already active. Please complete it first.` });
      }
    }

    const newYear = await AcademicYear.create({
      year: normalizedYear,
      status: proposedStatus
    });

    res.status(201).json(newYear);
  } catch (error) {
    console.error('Error creating academic year:', error);
    res.status(500).json({ error: error.message || 'Error creating academic year' });
  }
};

export const updateAcademicYearStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['Active', 'Completed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Status must be Active or Completed.' });
    }

    const targetYear = await AcademicYear.findById(id);
    if (!targetYear) {
      return res.status(404).json({ error: 'Academic Year not found' });
    }

    if (status === 'Active') {
      await AcademicYear.updateMany(
        { _id: { $ne: id }, status: 'Active' },
        { $set: { status: 'Completed' } }
      );
    }

    targetYear.status = status;
    await targetYear.save();

    res.json(targetYear);
  } catch (error) {
    console.error('Error updating academic year status:', error);
    res.status(500).json({ error: 'Error updating academic year status' });
  }
};

export const getStudentAcademicHistory = async (req, res) => {
  try {
    const { studentId } = req.params;
    const enrollments = await StudentEnrollment.find({ studentId })
      .populate('academicYearId', 'year status')
      .select('studentId academicYearId academicYear classId className sectionId sectionName status joinedDate promotedDate createdAt updatedAt')
      .sort({ createdAt: 1 })
      .lean();
    res.json(enrollments);
  } catch (error) {
    console.error('Error fetching student academic history:', error);
    res.status(500).json({ error: 'Error fetching student academic history' });
  }
};
