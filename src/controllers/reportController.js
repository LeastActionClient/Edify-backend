import prisma from '../utils/prisma.js';

export const getDailyCollection = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const payments = await prisma.payment.findMany({
      where: {
        paymentDate: {
          gte: today
        }
      },
      include: {
        student: { select: { studentName: true, admissionNumber: true } },
        studentFee: { include: { feeCategory: true } },
        recordedBy: { select: { username: true } }
      }
    });

    const total = payments.reduce((sum, p) => sum + p.amount, 0);

    res.json({ total, payments });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching daily collection' });
  }
};

export const getMonthlyCollection = async (req, res) => {
  try {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

    const payments = await prisma.payment.findMany({
      where: {
        paymentDate: {
          gte: firstDay
        }
      },
      include: {
        student: { select: { studentName: true, admissionNumber: true } },
        studentFee: { include: { feeCategory: true } },
        recordedBy: { select: { username: true } }
      }
    });

    const total = payments.reduce((sum, p) => sum + p.amount, 0);

    res.json({ total, payments });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching monthly collection' });
  }
};

export const getWeeklyCollection = async (req, res) => {
  try {
    const today = new Date();
    // Get Monday of the current week
    const firstDay = new Date(today);
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1); 
    firstDay.setDate(diff);
    firstDay.setHours(0, 0, 0, 0);

    const payments = await prisma.payment.findMany({
      where: {
        paymentDate: {
          gte: firstDay
        }
      },
      include: {
        student: { select: { studentName: true, admissionNumber: true } },
        studentFee: { include: { feeCategory: true } },
        recordedBy: { select: { username: true } }
      }
    });

    const total = payments.reduce((sum, p) => sum + p.amount, 0);
    res.json({ total, payments });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching weekly collection' });
  }
};

export const getYearlyCollection = async (req, res) => {
  try {
    const today = new Date();
    // Assuming academic year or simple calendar year
    const firstDay = new Date(today.getFullYear(), 0, 1);

    const payments = await prisma.payment.findMany({
      where: {
        paymentDate: {
          gte: firstDay
        }
      },
      include: {
        student: { select: { studentName: true, admissionNumber: true } },
        studentFee: { include: { feeCategory: true } },
        recordedBy: { select: { username: true } }
      }
    });

    const total = payments.reduce((sum, p) => sum + p.amount, 0);
    res.json({ total, payments });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching yearly collection' });
  }
};

export const getPendingFees = async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      include: {
        studentFees: { include: { feeCategory: true } }
      }
    });

    let totalPending = 0;
    const pendingFees = [];

    students.forEach(student => {
      if (!student.studentFees || student.studentFees.length === 0) return;
      
      const fullFee = student.studentFees.find(f => f.feeCategory?.name?.toLowerCase().includes('full'));
      const totalPaid = student.studentFees.reduce((sum, f) => sum + f.paidAmount, 0);
      let pendingAmount = 0;

      if (fullFee) {
        pendingAmount = Math.max(0, fullFee.totalAmount - totalPaid);
      } else {
        pendingAmount = student.studentFees.reduce((sum, f) => sum + f.remainingAmount, 0);
      }

      if (pendingAmount > 0) {
        totalPending += pendingAmount;
        // Mock a studentFee object so the frontend can render it if needed
        pendingFees.push({
          id: student.id,
          student: student,
          remainingAmount: pendingAmount,
          feeCategory: fullFee ? fullFee.feeCategory : { name: 'Combined Pending Dues' }
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
    const students = await prisma.student.findMany({
      include: {
        studentFees: {
          include: { feeCategory: true }
        }
      }
    });

    const report = students.map(student => {
      const fullFee = student.studentFees.find(f => f.feeCategory?.name?.toLowerCase().includes('full'));
      const totalPaid = student.studentFees.reduce((sum, f) => sum + f.paidAmount, 0);
      
      let totalAssigned = 0;
      let totalRemaining = 0;

      if (fullFee) {
        totalAssigned = fullFee.totalAmount;
        totalRemaining = Math.max(0, totalAssigned - totalPaid);
      } else {
        totalAssigned = student.studentFees.reduce((sum, f) => sum + f.totalAmount, 0);
        totalRemaining = student.studentFees.reduce((sum, f) => sum + f.remainingAmount, 0);
      }

      return {
        studentId: student.id,
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
    const feeCategories = await prisma.feeCategory.findMany({
      include: {
        studentFees: true
      }
    });

    const report = feeCategories.map(category => {
      const totalExpected = category.studentFees.reduce((sum, f) => sum + f.totalAmount, 0);
      const totalCollected = category.studentFees.reduce((sum, f) => sum + f.paidAmount, 0);
      const totalPending = category.studentFees.reduce((sum, f) => sum + f.remainingAmount, 0);

      return {
        categoryId: category.id,
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
