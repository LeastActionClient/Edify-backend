import { Student, Payment, StudentFee, FeeCategory, Application, StudentFeeConcession, Class, AcademicYear } from '../models/index.js';

const adjustFeesWithActiveConcessions = async (studentFees) => {
  if (!studentFees || studentFees.length === 0) return studentFees;
  
  const feeIds = studentFees.map(f => f._id);
  const concessions = await StudentFeeConcession.find({
    studentFeeId: { $in: feeIds },
    status: 'Active'
  })
    .select('studentFeeId lessAmount')
    .lean();
  
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

const withPaymentDetails = (query) =>
  query
    .populate('studentId', 'studentName admissionNumber currentClass section academicYear studentStatus')
    .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId', select: 'name amount pricing mandatory isStockItem currentStock topStock bottomStock' } })
    .populate({ path: 'feeAllocations.studentFeeId', populate: { path: 'feeCategoryId', select: 'name amount pricing mandatory isStockItem currentStock topStock bottomStock' } })
    .populate('recordedById', 'username');

const withApplicationDetails = (query) =>
  query.populate('processedById', 'username');

const buildCollectionResponse = async ({ start, end }) => {
  const paymentQuery = {
    paymentDate: { $gte: start, $lte: end },
    paymentType: { $ne: 'APPLICATION' }
  };
  const applicationQuery = {
    feePaid: true,
    feePaidDate: { $gte: start, $lte: end }
  };

  const [payments, appFees] = await Promise.all([
    withPaymentDetails(
      Payment.find(paymentQuery)
        .select('studentId applicationId studentFeeId feeAllocations amount paymentDate paymentMethod recordedById paymentType')
        .lean()
    ),
    withApplicationDetails(
      Application.find(applicationQuery)
        .select('applicationId studentName feeAmount feePaidDate processedById')
        .lean()
    )
  ]);

  const paymentTotal = payments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
  const applicationTotal = appFees.reduce((sum, app) => sum + (app.feeAmount || 0), 0);

  const formattedAppFees = appFees.map((app) => ({
    _id: app._id,
    amount: app.feeAmount || 0,
    paymentDate: app.feePaidDate,
    paymentMethod: 'Cash',
    paymentType: 'APPLICATION',
    studentId: { studentName: app.studentName, admissionNumber: app.applicationId },
    studentFeeId: { feeCategoryId: { name: 'Application Fee' } },
    recordedById: app.processedById
  }));

  return {
    total: paymentTotal + applicationTotal,
    payments: [...payments, ...formattedAppFees]
  };
};

export const getDashboardOverview = async (req, res) => {
  try {
    const [
      applications,
      activeStudents,
      totalStudents,
      rteStudents,
      paymentTotals,
      applicationTotals,
      activeYear,
      classes,
      academicYears
    ] = await Promise.all([
      Application.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            pending: {
              $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] }
            },
            approved: {
              $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] }
            }
          }
        }
      ]),
      Student.countDocuments({
        $or: [
          { studentStatus: { $exists: false } },
          { studentStatus: null },
          { studentStatus: 'Active' }
        ]
      }),
      Student.countDocuments({}),
      Student.countDocuments({
        RTE: { $regex: /rte|yes|true|1/i }
      }),
      Payment.aggregate([
        { $match: { paymentType: { $ne: 'APPLICATION' } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Application.aggregate([
        { $match: { feePaid: true } },
        { $group: { _id: null, total: { $sum: '$feeAmount' } } }
      ]),
      AcademicYear.findOne({ status: 'Active' })
        .select('year status createdAt updatedAt')
        .lean(),
      Class.find()
        .select('name createdAt updatedAt')
        .sort({ name: 1 })
        .lean(),
      AcademicYear.find()
        .select('year status createdAt updatedAt')
        .sort({ year: -1 })
        .lean()
    ]);

    const applicationTotalsDoc = applications[0] || { total: 0, pending: 0, approved: 0 };
    const paymentTotal = paymentTotals[0]?.total || 0;
    const appFeeTotal = applicationTotals[0]?.total || 0;
    const collections = paymentTotal + appFeeTotal;

    res.json({
      stats: {
        applications: applicationTotalsDoc.total || 0,
        pendingApplications: applicationTotalsDoc.pending || 0,
        approvedApplications: applicationTotalsDoc.approved || 0,
        students: activeStudents,
        collections,
        RTEStudents: rteStudents,
        generalStudents: Math.max(0, totalStudents - rteStudents)
      },
      activeYear,
      classes,
      academicYears
    });
  } catch (error) {
    console.error('Error fetching dashboard overview:', error);
    res.status(500).json({ error: 'Error fetching dashboard overview' });
  }
};

export const getDailyCollection = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await buildCollectionResponse({ start: today, end: endOfDay });
    res.json(result);
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

    const result = await buildCollectionResponse({ start, end });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching custom collection' });
  }
};

export const getMonthlyCollection = async (req, res) => {
  try {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

    const result = await buildCollectionResponse({ start: firstDay, end: new Date() });
    res.json(result);
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

    const result = await buildCollectionResponse({ start: firstDay, end: new Date() });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching weekly collection' });
  }
};

export const getYearlyCollection = async (req, res) => {
  try {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), 0, 1);

    const result = await buildCollectionResponse({ start: firstDay, end: new Date() });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching yearly collection' });
  }
};

export const getPendingFees = async (req, res) => {
  try {
    const students = await Student.find()
      .select('studentName admissionNumber currentClass section academicYear studentStatus')
      .lean();
    const studentIds = students.map(s => s._id);
    let studentFees = await StudentFee.find({ studentId: { $in: studentIds } })
      .select('studentId feeCategoryId totalAmount paidAmount remainingAmount academicYear className')
      .populate('feeCategoryId', 'name amount mandatory pricing isStockItem currentStock')
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
    const students = await Student.find()
      .select('studentName admissionNumber currentClass section academicYear studentStatus')
      .lean();
    const studentIds = students.map(s => s._id);
    let studentFees = await StudentFee.find({ studentId: { $in: studentIds } })
      .select('studentId feeCategoryId totalAmount paidAmount remainingAmount academicYear className')
      .populate('feeCategoryId', 'name amount mandatory pricing isStockItem currentStock')
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
    const feeCategories = await FeeCategory.find().select('name').lean();
    const categoryIds = feeCategories.map(c => c._id);
    let studentFees = await StudentFee.find({ feeCategoryId: { $in: categoryIds } })
      .select('studentId feeCategoryId totalAmount paidAmount remainingAmount')
      .lean();

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
