import { Student, Payment, StudentFee, FeeCategory, Application, StudentFeeConcession } from '../models/index.js';

const adjustFeesWithActiveConcessions = async (studentFees) => {
  if (!studentFees || studentFees.length === 0) return studentFees;
  
  const feeIds = studentFees.map(f => f._id);
  const concessions = await StudentFeeConcession.find({
    studentFeeId: { $in: feeIds },
    status: 'Active'
  }).lean();
  
  const concessionMap = new Map(concessions.map(c => [c.studentFeeId.toString(), c.lessAmount]));
  
  return studentFees.map(fee => {
    const fObj = fee.toObject ? fee.toObject() : { ...fee };
    const lessAmt = concessionMap.get(fObj._id.toString()) || 0;
    if (lessAmt > 0) {
      fObj.lessAmount = lessAmt;
      fObj.remainingAmount = Math.max(0, fObj.totalAmount - lessAmt - (fObj.paidAmount || 0));
    } else {
      fObj.lessAmount = 0;
    }
    return fObj;
  });
};

export const getDailyCollection = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const payments = await Payment.find({ paymentDate: { $gte: today } })
      .populate('studentId', 'studentName admissionNumber')
      .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId' } })
      .populate({ path: 'feeAllocations.studentFeeId', populate: { path: 'feeCategoryId' } })
      .populate('recordedById', 'username');

    const appFees = await Application.find({ feePaid: true, feePaidDate: { $gte: today } })
      .populate('processedById', 'username');

    let total = payments.reduce((sum, p) => sum + p.amount, 0);
    total += appFees.reduce((sum, app) => sum + (app.feeAmount || 0), 0);

    const formattedAppFees = appFees.map(app => ({
      _id: app._id,
      amount: app.feeAmount || 0,
      paymentDate: app.feePaidDate,
      paymentMethod: 'Cash',
      studentId: { studentName: app.studentName, admissionNumber: app.applicationId },
      studentFeeId: { feeCategoryId: { name: 'Application Fee' } },
      recordedById: app.processedById
    }));

    res.json({ total, payments: [...payments, ...formattedAppFees] });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching daily collection' });
  }
};

export const getCustomCollection = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const payments = await Payment.find({ paymentDate: { $gte: start, $lte: end } })
      .populate('studentId', 'studentName admissionNumber')
      .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId' } })
      .populate({ path: 'feeAllocations.studentFeeId', populate: { path: 'feeCategoryId' } })
      .populate('recordedById', 'username');

    const appFees = await Application.find({ feePaid: true, feePaidDate: { $gte: start, $lte: end } })
      .populate('processedById', 'username');

    let total = payments.reduce((sum, p) => sum + p.amount, 0);
    total += appFees.reduce((sum, app) => sum + (app.feeAmount || 0), 0);

    const formattedAppFees = appFees.map(app => ({
      _id: app._id,
      amount: app.feeAmount || 0,
      paymentDate: app.feePaidDate,
      paymentMethod: 'Cash',
      studentId: { studentName: app.studentName, admissionNumber: app.applicationId },
      studentFeeId: { feeCategoryId: { name: 'Application Fee' } },
      recordedById: app.processedById
    }));

    res.json({ total, payments: [...payments, ...formattedAppFees] });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching custom collection' });
  }
};

export const getMonthlyCollection = async (req, res) => {
  try {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

    const payments = await Payment.find({ paymentDate: { $gte: firstDay } })
      .populate('studentId', 'studentName admissionNumber')
      .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId' } })
      .populate({ path: 'feeAllocations.studentFeeId', populate: { path: 'feeCategoryId' } })
      .populate('recordedById', 'username');

    const appFees = await Application.find({ feePaid: true, feePaidDate: { $gte: firstDay } })
      .populate('processedById', 'username');

    let total = payments.reduce((sum, p) => sum + p.amount, 0);
    total += appFees.reduce((sum, app) => sum + (app.feeAmount || 0), 0);

    const formattedAppFees = appFees.map(app => ({
      _id: app._id,
      amount: app.feeAmount || 0,
      paymentDate: app.feePaidDate,
      paymentMethod: 'Cash',
      studentId: { studentName: app.studentName, admissionNumber: app.applicationId },
      studentFeeId: { feeCategoryId: { name: 'Application Fee' } },
      recordedById: app.processedById
    }));

    res.json({ total, payments: [...payments, ...formattedAppFees] });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching monthly collection' });
  }
};

export const getWeeklyCollection = async (req, res) => {
  try {
    const today = new Date();
    const firstDay = new Date(today);
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    firstDay.setDate(diff);
    firstDay.setHours(0, 0, 0, 0);

    const payments = await Payment.find({ paymentDate: { $gte: firstDay } })
      .populate('studentId', 'studentName admissionNumber')
      .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId' } })
      .populate({ path: 'feeAllocations.studentFeeId', populate: { path: 'feeCategoryId' } })
      .populate('recordedById', 'username');

    const appFees = await Application.find({ feePaid: true, feePaidDate: { $gte: firstDay } })
      .populate('processedById', 'username');

    let total = payments.reduce((sum, p) => sum + p.amount, 0);
    total += appFees.reduce((sum, app) => sum + (app.feeAmount || 0), 0);

    const formattedAppFees = appFees.map(app => ({
      _id: app._id,
      amount: app.feeAmount || 0,
      paymentDate: app.feePaidDate,
      paymentMethod: 'Cash',
      studentId: { studentName: app.studentName, admissionNumber: app.applicationId },
      studentFeeId: { feeCategoryId: { name: 'Application Fee' } },
      recordedById: app.processedById
    }));

    res.json({ total, payments: [...payments, ...formattedAppFees] });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching weekly collection' });
  }
};

export const getYearlyCollection = async (req, res) => {
  try {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), 0, 1);

    const payments = await Payment.find({ paymentDate: { $gte: firstDay } })
      .populate('studentId', 'studentName admissionNumber')
      .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId' } })
      .populate({ path: 'feeAllocations.studentFeeId', populate: { path: 'feeCategoryId' } })
      .populate('recordedById', 'username');

    const appFees = await Application.find({ feePaid: true, feePaidDate: { $gte: firstDay } })
      .populate('processedById', 'username');

    let total = payments.reduce((sum, p) => sum + p.amount, 0);
    total += appFees.reduce((sum, app) => sum + (app.feeAmount || 0), 0);

    const formattedAppFees = appFees.map(app => ({
      _id: app._id,
      amount: app.feeAmount || 0,
      paymentDate: app.feePaidDate,
      paymentMethod: 'Cash',
      studentId: { studentName: app.studentName, admissionNumber: app.applicationId },
      studentFeeId: { feeCategoryId: { name: 'Application Fee' } },
      recordedById: app.processedById
    }));

    res.json({ total, payments: [...payments, ...formattedAppFees] });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching yearly collection' });
  }
};

export const getPendingFees = async (req, res) => {
  try {
    const students = await Student.find().lean();
    const studentIds = students.map(s => s._id);
    let studentFees = await StudentFee.find({ studentId: { $in: studentIds } })
      .populate('feeCategoryId')
      .lean();

    studentFees = await adjustFeesWithActiveConcessions(studentFees);

    const feesByStudent = {};
    studentFees.forEach(fee => {
      const sid = fee.studentId.toString();
      if (!feesByStudent[sid]) feesByStudent[sid] = [];
      feesByStudent[sid].push(fee);
    });

    students.forEach(s => {
      s.studentFees = feesByStudent[s._id.toString()] || [];
    });

    let totalPending = 0;
    const pendingFees = [];

    students.forEach(student => {
      if (!student.studentFees || student.studentFees.length === 0) return;

      const fullFee = student.studentFees.find(f => f.feeCategoryId?.name?.toLowerCase().includes('full'));
      const totalPaid = student.studentFees.reduce((sum, f) => sum + f.paidAmount, 0);
      let pendingAmount = 0;

      if (fullFee) {
        pendingAmount = Math.max(0, fullFee.totalAmount - (fullFee.lessAmount || 0) - totalPaid);
      } else {
        pendingAmount = student.studentFees.reduce((sum, f) => sum + f.remainingAmount, 0);
      }

      if (pendingAmount > 0) {
        totalPending += pendingAmount;
        pendingFees.push({
          id: student._id,
          student,
          remainingAmount: pendingAmount,
          feeCategory: fullFee ? fullFee.feeCategoryId : { name: 'Combined Pending Dues' }
        });
      }
    });

    res.json({ totalPending, pendingFees });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching pending fees' });
  }
};

export const getStudentFeeReport = async (req, res) => {
  try {
    const students = await Student.find().lean();
    const studentIds = students.map(s => s._id);
    let studentFees = await StudentFee.find({ studentId: { $in: studentIds } })
      .populate('feeCategoryId')
      .lean();

    studentFees = await adjustFeesWithActiveConcessions(studentFees);

    const feesByStudent = {};
    studentFees.forEach(fee => {
      const sid = fee.studentId.toString();
      if (!feesByStudent[sid]) feesByStudent[sid] = [];
      feesByStudent[sid].push(fee);
    });

    students.forEach(s => {
      s.studentFees = feesByStudent[s._id.toString()] || [];
    });

    const report = students.map(student => {
      const fullFee = student.studentFees.find(f => f.feeCategoryId?.name?.toLowerCase().includes('full'));
      const totalPaid = student.studentFees.reduce((sum, f) => sum + f.paidAmount, 0);

      let totalAssigned = 0;
      let totalRemaining = 0;

      if (fullFee) {
        totalAssigned = fullFee.totalAmount - (fullFee.lessAmount || 0);
        totalRemaining = Math.max(0, totalAssigned - totalPaid);
      } else {
        totalAssigned = student.studentFees.reduce((sum, f) => sum + (f.totalAmount - (f.lessAmount || 0)), 0);
        totalRemaining = student.studentFees.reduce((sum, f) => sum + f.remainingAmount, 0);
      }

      return {
        studentId: student._id,
        studentName: student.studentName,
        admissionNumber: student.admissionNumber,
        currentClass: student.currentClass,
        totalAssigned,
        totalPaid,
        totalRemaining
      };
    });

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching student fee report' });
  }
};

export const getCategoryWiseCollection = async (req, res) => {
  try {
    const feeCategories = await FeeCategory.find().lean();
    const categoryIds = feeCategories.map(c => c._id);
    let studentFees = await StudentFee.find({ feeCategoryId: { $in: categoryIds } }).lean();

    studentFees = await adjustFeesWithActiveConcessions(studentFees);

    const feesByCategory = {};
    studentFees.forEach(fee => {
      const cid = fee.feeCategoryId.toString();
      if (!feesByCategory[cid]) feesByCategory[cid] = [];
      feesByCategory[cid].push(fee);
    });

    feeCategories.forEach(c => {
      c.studentFees = feesByCategory[c._id.toString()] || [];
    });

    const report = feeCategories.map(category => {
      const totalExpected = category.studentFees.reduce((sum, f) => sum + (f.totalAmount - (f.lessAmount || 0)), 0);
      const totalCollected = category.studentFees.reduce((sum, f) => sum + f.paidAmount, 0);
      const totalPending = category.studentFees.reduce((sum, f) => sum + f.remainingAmount, 0);

      return {
        categoryId: category._id,
        categoryName: category.name,
        totalExpected,
        totalCollected,
        totalPending
      };
    });

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching category-wise collection' });
  }
};
