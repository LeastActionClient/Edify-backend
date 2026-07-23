import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Student, StudentFee, StudentEnrollment, Payment, StudentFeeConcession } from './src/models/index.js';

dotenv.config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const id = '6a61e09417032ee59a47f0d0';
  const s = await Student.findById(id).lean();

  const [studentFees, concessions, payments, enrollments] = await Promise.all([
    StudentFee.find({ studentId: id })
      .select('studentId feeCategoryId totalAmount paidAmount remainingAmount academicYear className uniformDetails isStockDeducted createdAt updatedAt')
      .populate('feeCategoryId', 'name amount mandatory pricing isStockItem currentStock topStock bottomStock')
      .lean(),
    StudentFeeConcession.find({
      studentId: id,
      status: { $in: ['Active', 'Inactive'] }
    })
      .select('studentId studentFeeId lessAmount status')
      .lean(),
    Payment.find({ studentId: id })
      .select('studentId paymentDate feeAllocations amount createdAt')
      .lean(),
    StudentEnrollment.find({ studentId: id })
      .select('studentId academicYearId academicYear classId className sectionId sectionName status joinedDate promotedDate createdAt updatedAt')
      .sort({ joinedDate: 1, createdAt: 1 })
      .lean()
  ]);

  const concessionMap = new Map();
  concessions.forEach(c => {
    concessionMap.set(c.studentFeeId.toString(), c);
  });

  const activeEnrollment = enrollments.find(enrollment => enrollment.status === 'Active')
    || enrollments[enrollments.length - 1]
    || null;

  const allFees = studentFees.map(fee => {
    const fObj = { ...fee };
    const concession = concessionMap.get(fObj._id.toString());
    fObj.feeCategory = fObj.feeCategoryId;
    
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

  const currentClassFees = allFees.filter(f =>
    f.className === s.currentClass || (!f.className && !f.academicYear)
  );
  const previousClassFees = allFees.filter(f =>
    f.className && f.className !== s.currentClass
  );

  const joinedDate = activeEnrollment ? new Date(activeEnrollment.joinedDate || activeEnrollment.createdAt) : null;
  
  const currentYearPayments = joinedDate
    ? payments.filter(p => new Date(p.paymentDate || p.createdAt) >= joinedDate)
    : payments;

  let previousPaidThisYear = 0;
  const previousFeeIdsSet = new Set(previousClassFees.map(f => f._id.toString()));
  currentYearPayments.forEach(p => {
    (p.feeAllocations || []).forEach(alloc => {
      if (previousFeeIdsSet.has(alloc.studentFeeId?.toString())) {
        previousPaidThisYear += (alloc.amount || 0);
      }
    });
  });

  let currentPaidThisYear = 0;
  const currentFeeIdsSet = new Set(currentClassFees.map(f => f._id.toString()));
  currentYearPayments.forEach(p => {
    (p.feeAllocations || []).forEach(alloc => {
      if (currentFeeIdsSet.has(alloc.studentFeeId?.toString())) {
        currentPaidThisYear += (alloc.amount || 0);
      }
    });
  });

  const previousPending = previousClassFees.reduce((sum, f) => sum + (f.remainingAmount || 0), 0);
  const currentPending = currentClassFees.reduce((sum, f) => sum + (f.remainingAmount || 0), 0);
  const totalDue = previousPending + currentPending;

  const previousPendingAtPromotion = previousPending + previousPaidThisYear;
  const currentYearNetFee = currentClassFees.reduce((sum, f) => {
    const concessionAmount = f.concessionStatus === 'Active' ? (f.lessAmount || 0) : 0;
    return sum + Math.max(0, (f.totalAmount || 0) - concessionAmount);
  }, 0);
  
  const totalFee = previousPendingAtPromotion + currentYearNetFee;

  console.log("=== Calculated API Fields ===");
  console.log("studentName:", s.studentName);
  console.log("currentClass:", s.currentClass);
  console.log("academicYear:", s.academicYear);
  console.log("previousPending:", previousPending);
  console.log("currentPending:", currentPending);
  console.log("totalDue:", totalDue);
  console.log("totalFee:", totalFee);
  console.log("previousPaid:", previousPaidThisYear);
  console.log("currentPaid:", currentPaidThisYear);

  await mongoose.disconnect();
}

check().catch(console.error);
