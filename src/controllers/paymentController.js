import mongoose from 'mongoose';
import { Student, StudentFee, Payment, Invoice, FeeCategory, ActivityLog, StockHistory, StudentFeeConcession } from '../models/index.js';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { logoBase64 } from '../utils/logoBase64.js';

const EFFECTIVE_CONCESSION_STATUSES = new Set(['Active', 'Completed', 'Expired']);

const generateInvoiceNumber = async () => {
  const currentYear = new Date().getFullYear();
  // Find the invoice with the highest number for the current year
  const lastInvoice = await Invoice.findOne({ invoiceNumber: new RegExp(`^INV-${currentYear}-`) })
    .select('invoiceNumber')
    .sort({ invoiceNumber: -1 });

  let nextCount = 1;
  if (lastInvoice && lastInvoice.invoiceNumber) {
    const parts = lastInvoice.invoiceNumber.split('-');
    if (parts.length === 3) {
      nextCount = parseInt(parts[2], 10) + 1;
    }
  }
  return `INV-${currentYear}-${String(nextCount).padStart(5, '0')}`;
};

const MM_TO_PT = 72 / 25.4;
const mmToPt = (value) => value * MM_TO_PT;

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const applyConcessionSnapshot = (fee, concession) => {
  const feeDoc = fee || {};
  const concessionDoc = concession || null;

  if (!concessionDoc) {
    feeDoc.lessAmount = 0;
    feeDoc.discountAmount = 0;
    feeDoc.concessionStatus = 'None';
    return feeDoc;
  }

  feeDoc.concessionStatus = concessionDoc.status || 'None';

  if (EFFECTIVE_CONCESSION_STATUSES.has(concessionDoc.status)) {
    feeDoc.lessAmount = concessionDoc.lessAmount || 0;
    feeDoc.discountAmount = concessionDoc.lessAmount || 0;
    feeDoc.remainingAmount = Math.max(0, (feeDoc.totalAmount || 0) - (concessionDoc.lessAmount || 0) - (feeDoc.paidAmount || 0));
  } else {
    feeDoc.lessAmount = 0;
    feeDoc.discountAmount = 0;
    feeDoc.remainingAmount = Math.max(0, (feeDoc.totalAmount || 0) - (feeDoc.paidAmount || 0));
  }

  return feeDoc;
};

const normalizeSpaces = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const titleCase = (value) =>
  normalizeSpaces(value)
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const splitFeeName = (value) => {
  const rawName = normalizeSpaces(value);
  const match = rawName.match(/^(.*?)(?:\s*-?\s*)(\d{1,2})$/i);

  if (!match || !normalizeSpaces(match[1])) {
    return {
      rawName,
      baseName: rawName,
      suffix: null,
      isGroupedCandidate: false
    };
  }

  return {
    rawName,
    baseName: normalizeSpaces(match[1]),
    suffix: Number(match[2]),
    isGroupedCandidate: true
  };
};

const buildReceiptEntry = (source, fallbackAmount = 0) => {
  const fee = source?.studentFeeId || source?.studentFee || source || {};
  const feeName = fee.feeCategoryId?.name || fee.name || 'Fee';
  const totalAmount = toNumber(fee.totalAmount);
  const paidAmount = toNumber(source?.amount ?? fallbackAmount);
  const balanceAmount = toNumber(fee.remainingAmount);
  const discountAmount = toNumber(
    source?.discountAmount ??
      source?.lessAmount ??
      source?.concessionAmount ??
      fee.discountAmount ??
      fee.lessAmount ??
      fee.concessionAmount
  );

  return {
    rawName: feeName,
    displayName: titleCase(feeName),
    totalAmount,
    paidAmount,
    balanceAmount: Number.isFinite(balanceAmount) && balanceAmount >= 0 ? balanceAmount : 0,
    discountAmount
  };
};

const groupFeeAllocationsForReceipt = (payment) => {
  if (payment?.paymentType === 'APPLICATION') {
    return [{
      name: 'Application Fee',
      displayName: 'Application Fee',
      terms: [],
      totalAmount: payment.amount,
      discountAmount: 0,
      paidAmount: payment.amount,
      balanceAmount: 0,
      rows: []
    }];
  }

  const feeAllocations = Array.isArray(payment?.feeAllocations) ? payment.feeAllocations : [];
  const studentFee = payment?.studentFee || payment?.studentFeeId || null;

  const entries = feeAllocations.length > 0
    ? feeAllocations.map((allocation) => buildReceiptEntry(allocation))
    : studentFee
      ? [buildReceiptEntry(studentFee, payment?.amount)]
      : [];

  const grouped = [];
  const groupedMap = new Map();

  entries.forEach((entry, index) => {
    const { baseName, suffix, isGroupedCandidate } = splitFeeName(entry.rawName);
    const groupKey = isGroupedCandidate ? normalizeSpaces(baseName).toLowerCase() : `__single_${index}`;

    if (!groupedMap.has(groupKey)) {
      const group = {
        baseName: titleCase(baseName),
        displayName: entry.displayName,
        terms: [],
        rows: [],
        totalAmount: 0,
        discountAmount: 0,
        paidAmount: 0,
        balanceAmount: 0,
        sortIndex: index
      };
      groupedMap.set(groupKey, group);
      grouped.push(group);
    }

    const group = groupedMap.get(groupKey);
    group.rows.push(entry);
    group.totalAmount += entry.totalAmount;
    group.discountAmount += entry.discountAmount;
    group.paidAmount += entry.paidAmount;
    group.balanceAmount += entry.balanceAmount;

    if (suffix !== null && suffix !== undefined && Number.isFinite(suffix)) {
      group.terms.push(suffix);
    }
  });

  return grouped.map((group) => {
    const sortedTerms = [...new Set(group.terms)].sort((a, b) => a - b);
    const shouldCollapse = sortedTerms.length > 1;

    return {
      name: group.baseName || group.displayName,
      displayName: shouldCollapse
        ? `${group.baseName || group.displayName} - ${sortedTerms.join(',')}`
        : group.rows[0]?.displayName || group.displayName,
      terms: sortedTerms,
      totalAmount: group.totalAmount,
      discountAmount: group.discountAmount,
      paidAmount: group.paidAmount,
      balanceAmount: group.balanceAmount,
      rows: group.rows,
      sortIndex: group.sortIndex
    };
  });
};

const calculateReceiptTotals = (groupedRows) =>
  groupedRows.reduce(
    (acc, row) => ({
      totalAmount: acc.totalAmount + toNumber(row.totalAmount),
      discountAmount: acc.discountAmount + toNumber(row.discountAmount),
      paidAmount: acc.paidAmount + toNumber(row.paidAmount),
      balanceAmount: acc.balanceAmount + toNumber(row.balanceAmount)
    }),
    {
      totalAmount: 0,
      discountAmount: 0,
      paidAmount: 0,
      balanceAmount: 0
    }
  );

const formatReceiptCurrency = (value) => `Rs. ${toNumber(value).toFixed(2)}`;
const formatReceiptDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
};

const drawReceiptCopy = ({
  doc,
  payment,
  invoice,
  groupedRows,
  totals,
  x,
  y,
  width,
  height,
  logoPath
}) => {
  const paddingX = mmToPt(2);
  const paddingY = mmToPt(1.5);
  const innerX = x + paddingX;
  const innerY = y + paddingY;
  const innerWidth = width - paddingX * 2;
  const descWidth = Math.round(innerWidth * 0.38);
  const totalWidth = Math.round(innerWidth * 0.13);
  const lessWidth = Math.round(innerWidth * 0.11);
  const paidWidth = Math.round(innerWidth * 0.13);
  const balanceWidth = innerWidth - descWidth - totalWidth - lessWidth - paidWidth;
  const rowHeight = mmToPt(4.4);

  const student = payment.studentId || payment.student || {};
  const application = payment.applicationId || payment.application || {};
  const receiptNumber = invoice?.invoiceNumber || payment._id?.toString?.() || '-';
  const receiptDate = formatReceiptDate(payment.paymentDate);

  doc.save();
  doc.roundedRect(x, y, width, height, 2)
    .lineWidth(0.5)
    .strokeColor('#CBD5E1')
    .stroke();

  try {
    const imageBuffer = Buffer.from(logoBase64, 'base64');
    doc.image(imageBuffer, innerX, innerY + mmToPt(0.1), {
      width: mmToPt(10)
    });
  } catch (imageError) {
    console.error('Error loading receipt logo', imageError);
  }

  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(10.8)
    .text('KASTHURI NURSERY AND PRIMARY SCHOOL', innerX + mmToPt(12), innerY + mmToPt(0.2), {
      width: innerWidth - mmToPt(24),
      align: 'center'
    });

  // doc.fillColor('#475569').font('Helvetica').fontSize(6.6)
  //   .text('No.15 & 44 Eda Street, Saidapet, Vellore - 632 012.', innerX, innerY + mmToPt(3.9), {
  //     width: innerWidth,
  //     align: 'center'
  //   })
    // .text('Phone: 0416-2211877, +91 97919 50179 | Email: Kasthurinurseryschool@gmail.com', innerX, innerY + mmToPt(6.7), {
    //   width: innerWidth,
    //   align: 'center'
    // });

  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(11.5)
    .text('FEE RECEIPT', innerX + innerWidth - mmToPt(40), innerY + mmToPt(0.3), { width: mmToPt(38), align: 'right' });

  const headerBottom = innerY + mmToPt(11.8);
  doc.moveTo(innerX, headerBottom).lineTo(innerX + innerWidth, headerBottom).strokeColor('#CBD5E1').stroke();

  const detailTop = headerBottom + mmToPt(1.0);
  const detailGap = mmToPt(8);
  const detailColumnWidth = (innerWidth - detailGap) / 2;
  const leftColX = innerX + mmToPt(3);
  const rightColX = innerX + detailColumnWidth + detailGap;
  const lineGap = mmToPt(4.0);

  doc.fillColor('#0F172A').font('Helvetica').fontSize(8.8);
  if (payment.paymentType === 'APPLICATION') {
    doc.text(`Application No: ${application.applicationId || '-'}`, leftColX, detailTop, { width: detailColumnWidth - mmToPt(4) });
    doc.text(`Receipt No: ${receiptNumber}`, leftColX, detailTop + lineGap, { width: detailColumnWidth - mmToPt(4) });
    doc.text(`Applicant Name: ${application.studentName || '-'}`, leftColX, detailTop + lineGap * 2, { width: detailColumnWidth - mmToPt(4) });

    doc.text(`Applying Class: ${application.applyingClass || '-'}`, rightColX, detailTop, { width: detailColumnWidth - mmToPt(4), align: 'right' });
    doc.text(`Date: ${receiptDate}`, rightColX, detailTop + lineGap, { width: detailColumnWidth - mmToPt(4), align: 'right' });
    doc.text(`Payment Mode: ${payment.paymentMethod || '-'}`, rightColX, detailTop + lineGap * 2, { width: detailColumnWidth - mmToPt(4), align: 'right' });
  } else {
    doc.text(`Class & Section: ${student.currentClass || '-'}`, leftColX, detailTop, { width: detailColumnWidth - mmToPt(4) });
    doc.text(`Receipt No: ${receiptNumber}`, leftColX, detailTop + lineGap, { width: detailColumnWidth - mmToPt(4) });
    doc.text(`Student Name: ${student.studentName || '-'}`, leftColX, detailTop + lineGap * 2, { width: detailColumnWidth - mmToPt(4) });

    doc.text(` Admission No: ${student.admissionNumber || '-'} ${student.section || ''}`, rightColX, detailTop, { width: detailColumnWidth - mmToPt(4), align: 'right' });
    doc.text(`Date: ${receiptDate}`, rightColX, detailTop + lineGap, { width: detailColumnWidth - mmToPt(4), align: 'right' });
    doc.text(`Payment Mode: ${payment.paymentMethod || '-'}`, rightColX, detailTop + lineGap * 2, { width: detailColumnWidth - mmToPt(4), align: 'right' });
  }

  const tableTop = detailTop + lineGap * 3 + mmToPt(1.0);
  const tableHeaderHeight = mmToPt(4.4);
  const tableWidth = innerWidth;

  doc.roundedRect(innerX, tableTop, tableWidth, tableHeaderHeight + groupedRows.length * rowHeight, 1.5)
    .lineWidth(0.4)
    .strokeColor('#CBD5E1')
    .stroke();

  doc.rect(innerX, tableTop, tableWidth, tableHeaderHeight)
    .fillAndStroke('#F1F5F9', '#CBD5E1');

  doc.fillColor('#334155').font('Helvetica-Bold').fontSize(8.2);
  doc.text('Fee Description', innerX + mmToPt(1.2), tableTop + mmToPt(1.0), { width: descWidth - mmToPt(2), ellipsis: true });
  doc.text('Total', innerX + descWidth, tableTop + mmToPt(1.0), { width: totalWidth, align: 'right' });
  doc.text('Less', innerX + descWidth + totalWidth, tableTop + mmToPt(1.2), { width: lessWidth, align: 'right' });
  doc.text('Paid', innerX + descWidth + totalWidth + lessWidth, tableTop + mmToPt(1.0), { width: paidWidth, align: 'right' });
  doc.text('Balance', innerX + descWidth + totalWidth + lessWidth + paidWidth, tableTop + mmToPt(1.0), { width: balanceWidth - mmToPt(1), align: 'right' });

  let rowTop = tableTop + tableHeaderHeight;
  doc.fillColor('#0F172A').font('Helvetica').fontSize(8.4);

  if (groupedRows.length === 0) {
    doc.text('No fee details available.', innerX, rowTop + mmToPt(1.5), {
      width: tableWidth,
      align: 'center'
    });
  } else {
    groupedRows.forEach((row, index) => {
      const rowY = rowTop + index * rowHeight;
      doc.moveTo(innerX, rowY).lineTo(innerX + tableWidth, rowY).strokeColor('#E2E8F0').stroke();
      doc.text(row.displayName, innerX + mmToPt(1.2), rowY + mmToPt(0.7), { width: descWidth - mmToPt(2), ellipsis: true });
      doc.text(formatReceiptCurrency(row.totalAmount), innerX + descWidth, rowY + mmToPt(0.7), { width: totalWidth - mmToPt(1), align: 'right' });
      doc.text(formatReceiptCurrency(row.discountAmount), innerX + descWidth + totalWidth, rowY + mmToPt(0.7), { width: lessWidth - mmToPt(1), align: 'right' });
      doc.text(formatReceiptCurrency(row.paidAmount), innerX + descWidth + totalWidth + lessWidth, rowY + mmToPt(0.7), { width: paidWidth - mmToPt(1), align: 'right' });
      doc.text(formatReceiptCurrency(row.balanceAmount), innerX + descWidth + totalWidth + lessWidth + paidWidth, rowY + mmToPt(0.7), { width: balanceWidth - mmToPt(1), align: 'right' });
    });
  }

  const tableBottom = rowTop + groupedRows.length * rowHeight;
  doc.moveTo(innerX, tableBottom).lineTo(innerX + tableWidth, tableBottom).strokeColor('#E2E8F0').stroke();

  const summaryTop = tableBottom + mmToPt(1.0);
  const summaryWidth = mmToPt(70);
  const summaryX = innerX + innerWidth - summaryWidth;

  doc.roundedRect(summaryX, summaryTop, summaryWidth, mmToPt(21), 1.2)
    .lineWidth(0.4)
    .strokeColor('#CBD5E1')
    .stroke();

  doc.fillColor('#334155').font('Helvetica-Bold').fontSize(8.6)
    .text('Grand Total', summaryX + mmToPt(1), summaryTop + mmToPt(0.6), { width: summaryWidth - mmToPt(2) });

  doc.fillColor('#0F172A').font('Helvetica').fontSize(8.6);
  const summaryLineY = summaryTop + mmToPt(4.0);
  doc.text('Total Amount', summaryX + mmToPt(1), summaryLineY, { width: summaryWidth - mmToPt(16) });
  doc.font('Helvetica-Bold');
  doc.text(formatReceiptCurrency(totals.totalAmount), summaryX + mmToPt(16), summaryLineY, { width: summaryWidth - mmToPt(17), align: 'right' });

  doc.restore();
};

const drawReceiptSheet = ({
  doc,
  payment,
  invoice,
  groupedRows,
  totals
}) => {
  const pageMargin = mmToPt(3);
  const sheetPadding = mmToPt(3);
  const columnGap = mmToPt(2.5);
  const rowGap = mmToPt(2.5);
  const contentX = pageMargin + sheetPadding;
  const contentY = pageMargin + sheetPadding;
  const contentWidth = doc.page.width - pageMargin * 2 - sheetPadding * 2;
  const contentHeight = doc.page.height - pageMargin * 2 - sheetPadding * 2;
  const cellWidth = (contentWidth - columnGap) / 2;
  const cellHeight = (contentHeight - rowGap) / 2;

  for (let index = 0; index < 4; index += 1) {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const cellX = contentX + col * (cellWidth + columnGap);
    const cellY = contentY + row * (cellHeight + rowGap);

    drawReceiptCopy({
      doc,
      payment,
      invoice,
      groupedRows,
      totals,
      x: cellX,
      y: cellY,
      width: cellWidth,
      height: cellHeight
    });
  }
};

const getInvoicePaymentData = async (id) => {
  const [paymentDoc, invoiceDoc] = await Promise.all([
    Payment.findById(id)
      .populate('studentId', 'studentName admissionNumber currentClass section academicYear studentStatus fatherPhone motherPhone whatsappNumber emisNo emisNumber guardianName guardian')
      .populate('applicationId', 'studentName applicationId applyingClass status feePaid feeAmount feePaidDate')
      .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId', select: 'name amount pricing mandatory isStockItem currentStock topStock bottomStock' } })
      .populate({ path: 'feeAllocations.studentFeeId', populate: { path: 'feeCategoryId', select: 'name amount pricing mandatory isStockItem currentStock topStock bottomStock' } })
      .populate('recordedById', 'username')
      .lean(),
    Invoice.findOne({ paymentId: id }).select('invoiceNumber paymentId studentId generatedDate createdAt updatedAt').lean()
  ]);

  if (!paymentDoc) {
    return null;
  }

  let invoice = invoiceDoc;

  if (!invoice && paymentDoc.paymentType === 'APPLICATION') {
    invoice = {
      invoiceNumber: `INV-APP-${paymentDoc.applicationId?.applicationId || paymentDoc._id.toString().slice(-5).toUpperCase()}`,
      paymentId: paymentDoc._id,
      generatedDate: paymentDoc.paymentDate || paymentDoc.createdAt
    };
  }

  if (!invoice) {
    return null;
  }

  const payment = paymentDoc;

  payment.invoice = invoice;

  if (payment.studentId) {
    payment.student = payment.studentId;
  }

  if (payment.applicationId) {
    payment.application = payment.applicationId;
  }

  // Load and apply concessions dynamically to match discountAmount in PDF / invoice details
  const studentIdForConcessions = payment.studentId?._id || payment.studentId;
  const concessions = studentIdForConcessions 
    ? await StudentFeeConcession.find({ studentId: studentIdForConcessions, status: { $in: ['Active', 'Inactive', 'Completed', 'Expired'] } })
      .select('studentFeeId lessAmount status academicYear academicYearId')
      .lean()
    : [];
  const concessionMap = new Map(concessions.map(c => [c.studentFeeId.toString(), c]));

  if (payment.studentFeeId) {
    payment.studentFee = payment.studentFeeId;
    if (payment.studentFee.feeCategoryId) {
      payment.studentFee.feeCategory = payment.studentFee.feeCategoryId;
    }
    applyConcessionSnapshot(payment.studentFee, concessionMap.get(payment.studentFee._id.toString()));
  }

  if (payment.feeAllocations && payment.feeAllocations.length > 0) {
    payment.feeAllocations.forEach(alloc => {
      if (alloc.studentFeeId) {
        const concession = concessionMap.get(alloc.studentFeeId._id.toString());
        applyConcessionSnapshot(alloc.studentFeeId, concession);
        alloc.discountAmount = alloc.studentFeeId.discountAmount || 0;
      }
    });
  }

  if (payment.recordedById) {
    payment.recordedBy = payment.recordedById;
  }

  let fullTotalAmount = 0;
  let fullRemainingBalance = 0;

  if (payment.feeAllocations && payment.feeAllocations.length > 0) {
    payment.feeAllocations.forEach((alloc) => {
      fullTotalAmount += alloc.studentFeeId?.totalAmount || 0;
      fullRemainingBalance += alloc.studentFeeId?.remainingAmount || 0;
    });
  } else if (payment.isFullPayment) {
    const studentId = payment.studentId?._id || payment.studentId;
    const allFees = await StudentFee.find({ studentId }).select('totalAmount remainingAmount').lean();
    fullTotalAmount = allFees.reduce((sum, fee) => sum + fee.totalAmount, 0);
    fullRemainingBalance = allFees.reduce((sum, fee) => sum + fee.remainingAmount, 0);
  }

  return {
    payment,
    invoice,
    summary: {
      fullTotalAmount,
      fullRemainingBalance
    }
  };
};

export const createPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { studentId, studentFeeIds, amount, feeAllocations: clientAllocations, paymentMethod, referenceNumber, remarks } = req.body;

    let targetAllocations = [];
    let resolvedFeeIds = studentFeeIds;

    if (clientAllocations && Array.isArray(clientAllocations) && clientAllocations.length > 0) {
      targetAllocations = clientAllocations.map(a => ({
        studentFeeId: a.studentFeeId.toString(),
        amount: parseFloat(a.amount || 0)
      }));
      resolvedFeeIds = targetAllocations.map(a => a.studentFeeId);
    }

    if (!resolvedFeeIds || !Array.isArray(resolvedFeeIds) || resolvedFeeIds.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'No fees selected for payment' });
    }

    // Self-heal any zero-amount StudentFee documents in MongoDB before balance validation
    for (const feeId of resolvedFeeIds) {
      const feeDoc = await StudentFee.findById(feeId).session(session);
      if (feeDoc && (feeDoc.totalAmount === 0 || feeDoc.remainingAmount === 0) && feeDoc.paidAmount === 0) {
        const cat = await FeeCategory.findById(feeDoc.feeCategoryId).session(session);
        if (cat) {
          let healedAmt = parseFloat(cat.amount || 0);
          if (cat.name.toLowerCase() === 'uniform' && cat.pricing) {
            const topPrice = parseFloat(cat.pricing.topPerMetre || 0);
            const bottomPrice = parseFloat(cat.pricing.bottomPerMetre || 0);
            const topLen = parseFloat(feeDoc.uniformDetails?.topLength || 0);
            const bottomLen = parseFloat(feeDoc.uniformDetails?.bottomLength || 0);
            healedAmt = (topLen * topPrice) + (bottomLen * bottomPrice);
          }
          if (healedAmt <= 0) {
            const classDoc = await Class.findOne({ name: feeDoc.className }).session(session);
            if (classDoc) {
              const feeConfig = classDoc.defaultFees?.[cat._id.toString()];
              if (typeof feeConfig === 'number' && feeConfig > 0) healedAmt = feeConfig;
              else if (feeConfig?.amount && parseFloat(feeConfig.amount) > 0) healedAmt = parseFloat(feeConfig.amount);
            }
          }
          if (healedAmt > 0) {
            await StudentFee.updateOne(
              { _id: feeDoc._id },
              { $set: { totalAmount: healedAmt, remainingAmount: healedAmt } },
              { session }
            );
          }
        }
      }
    }

    const student = await Student.findById(studentId).session(session);
    if (!student) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Student not found' });
    }

    const unpaidFees = await StudentFee.find({ _id: { $in: resolvedFeeIds }, studentId })
      .populate('feeCategoryId')
      .session(session);

    if (unpaidFees.length !== resolvedFeeIds.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Some fee records were not found or do not belong to this student' });
    }

    // Sort unpaidFees to ensure previous year pending fees are cleared first (Business Rule 9)
    unpaidFees.sort((a, b) => {
      const aIsPrev = (a.academicYear && student.academicYear && a.academicYear !== student.academicYear) || (!a.academicYear && a.className && student.currentClass && a.className !== student.currentClass);
      const bIsPrev = (b.academicYear && student.academicYear && b.academicYear !== student.academicYear) || (!b.academicYear && b.className && student.currentClass && b.className !== student.currentClass);
      
      if (aIsPrev && !bIsPrev) return -1;
      if (!aIsPrev && bIsPrev) return 1;
      return 0;
    });

    // Load active/inactive concessions for these fees
    const concessions = await StudentFeeConcession.find({
      studentFeeId: { $in: resolvedFeeIds },
      status: { $in: ['Active', 'Inactive', 'Completed', 'Expired'] }
    }).session(session).lean();

    const concessionMap = new Map(concessions.map(c => [c.studentFeeId.toString(), c]));

    // Use DB remainingAmount directly as the single source of truth
    unpaidFees.forEach(fee => {
      const concession = concessionMap.get(fee._id.toString());
      fee.originalRemainingAmount = fee.remainingAmount;
      fee.lessAmount = concession ? (concession.lessAmount || 0) : 0;
    });

    let finalAmount = amount;
    const isClientAllocation = clientAllocations && Array.isArray(clientAllocations) && clientAllocations.length > 0;

    if (isClientAllocation) {
      for (const alloc of targetAllocations) {
        const fee = unpaidFees.find(f => f._id.toString() === alloc.studentFeeId);
        if (!fee) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({ error: 'Associated Student Fee record for allocation not found.' });
        }

        if (alloc.amount < 0) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: 'Allocation amount cannot be negative.' });
        }

        if (alloc.amount > fee.remainingAmount) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            error: `Entered amount (Rs. ${alloc.amount}) cannot exceed the remaining payable amount (Rs. ${fee.remainingAmount}) for ${fee.feeCategoryId?.name || 'Fee'}.`
          });
        }
      }

      finalAmount = targetAllocations.reduce((sum, a) => sum + a.amount, 0);
      const totalRemaining = unpaidFees.reduce((sum, f) => sum + f.remainingAmount, 0);

      if (totalRemaining > 0 && finalAmount <= 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Total payment amount must be greater than zero.' });
      }
      if (finalAmount < 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Total payment amount cannot be negative.' });
      }
    } else {
      const totalRemaining = unpaidFees.reduce((sum, f) => sum + f.remainingAmount, 0);
      if (amount > totalRemaining) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          error: `Payment amount (Rs. ${amount}) cannot exceed the total remaining balance (Rs. ${totalRemaining}) for the selected fees.`
        });
      }
    }

    let amountLeftToDistribute = finalAmount;
    const feeAllocations = [];

    for (const fee of unpaidFees) {
      let paymentAmountForFee = 0;

      if (isClientAllocation) {
        const alloc = targetAllocations.find(a => a.studentFeeId === fee._id.toString());
        paymentAmountForFee = alloc ? alloc.amount : 0;
      } else {
        if (amountLeftToDistribute <= 0) break;
        paymentAmountForFee = Math.min(amountLeftToDistribute, fee.remainingAmount);
        amountLeftToDistribute -= paymentAmountForFee;
      }

      if (paymentAmountForFee < 0) continue;

      feeAllocations.push({ studentFeeId: fee._id, amount: paymentAmountForFee, discountAmount: fee.lessAmount || 0 });

      const originalRem = fee.originalRemainingAmount !== undefined ? fee.originalRemainingAmount : fee.remainingAmount;
      const newRemainingAmount = originalRem - paymentAmountForFee;
      const newPaidAmount = fee.paidAmount + paymentAmountForFee;
      const feeStatus = Math.max(0, fee.totalAmount - (fee.lessAmount || 0) - newPaidAmount) === 0 ? 'PAID' : 'PARTIAL';

      await StudentFee.findByIdAndUpdate(fee._id, {
        paidAmount: newPaidAmount,
        remainingAmount: newRemainingAmount
      }, { session });

      const relatedConcession = await StudentFeeConcession.findOne({ studentFeeId: fee._id }).session(session);
      if (relatedConcession && relatedConcession.status === 'Active' && newRemainingAmount <= 0) {
        relatedConcession.status = 'Completed';
        await relatedConcession.save({ session });
      }

      if (feeStatus === 'PAID') {
        const category = await FeeCategory.findById(fee.feeCategoryId).session(session);
        if (category && category.name.toLowerCase().includes('full')) {
          await StudentFee.updateMany(
            { studentId, _id: { $ne: fee._id }, remainingAmount: { $gt: 0 } },
            { remainingAmount: 0 },
            { session }
          );
        }
      }
    }

    const totalRemaining = unpaidFees.reduce((sum, f) => sum + f.remainingAmount, 0);

    const [payment] = await Payment.create([{
      studentId,
      isFullPayment: false, 
      feeAllocations,
      amount: finalAmount,
      paymentMethod,
      referenceNumber,
      remarks,
      status: finalAmount >= totalRemaining ? 'PAID' : 'PARTIAL',
      inventoryProcessed: false,
      recordedById: req.user?.id || req.user?._id || null
    }], { session });
    
    // Deduct stock atomically and set inventoryProcessed flag
    for (const alloc of feeAllocations) {
      const studentFee = unpaidFees.find(f => f._id.toString() === alloc.studentFeeId.toString());
      if (studentFee && studentFee.feeCategoryId) {
        const cat = await FeeCategory.findById(studentFee.feeCategoryId).session(session);
        if (cat && cat.isStockItem && !studentFee.isStockDeducted) {
          if (cat.name.toLowerCase() === 'uniform') {
            const topLen = parseFloat(studentFee.uniformDetails?.topLength || 0);
            const bottomLen = parseFloat(studentFee.uniformDetails?.bottomLength || 0);
            const updatedCat = await FeeCategory.findOneAndUpdate(
              { _id: cat._id, topStock: { $gte: topLen }, bottomStock: { $gte: bottomLen } },
              { $inc: { topStock: -topLen, bottomStock: -bottomLen } },
              { new: true, session }
            );

            if (!updatedCat) {
              await session.abortTransaction();
              session.endSession();
              return res.status(400).json({ error: `Insufficient stock for ${cat.name} (Top needed: ${topLen}m, Bottom needed: ${bottomLen}m).` });
            }

            await StockHistory.create([{
              categoryId: cat._id,
              categoryName: cat.name,
              previousStock: (updatedCat.topStock + topLen) + (updatedCat.bottomStock + bottomLen),
              updatedStock: updatedCat.topStock + updatedCat.bottomStock,
              difference: -(topLen + bottomLen),
              action: 'ASSIGNED',
              referenceType: 'Payment',
              referenceId: payment._id,
              updatedBy: req.user?.id || req.user?._id || req.user?.userId || null
            }], { session });
          } else {
            const updatedCat = await FeeCategory.findOneAndUpdate(
              { _id: cat._id, currentStock: { $gte: 1 } },
              { $inc: { currentStock: -1 } },
              { new: true, session }
            );

            if (!updatedCat) {
              await session.abortTransaction();
              session.endSession();
              return res.status(400).json({ error: `Insufficient stock for ${cat.name}. Stock was depleted by a concurrent transaction.` });
            }

            await StockHistory.create([{
              categoryId: cat._id,
              categoryName: cat.name,
              previousStock: updatedCat.currentStock + 1,
              updatedStock: updatedCat.currentStock,
              difference: -1,
              action: 'ASSIGNED',
              referenceType: 'Payment',
              referenceId: payment._id,
              updatedBy: req.user?.id || req.user?._id || req.user?.userId || null
            }], { session });
          }

          await StudentFee.findByIdAndUpdate(studentFee._id, {
            isStockDeducted: true
          }, { session });
        }
      }
    }

    payment.inventoryProcessed = true;
    await payment.save({ session });

    const invNum = await generateInvoiceNumber();
    const [invoice] = await Invoice.create([{
      invoiceNumber: invNum,
      paymentId: payment._id,
      studentId
    }], { session });
    
    await ActivityLog.create([{
      userId: req.user?.id || req.user?._id || req.user?.userId || null,
      action: 'CREATED_PAYMENT',
      details: `Payment of ${finalAmount} recorded for student ${studentId} covering multiple fees`
    }], { session });
    
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ ...payment.toObject(), invoice });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error(error);
    res.status(500).json({ error: error.message || 'Server error creating payment' });
  }
};

export const getPaymentHistory = async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate('studentId', 'studentName admissionNumber currentClass section academicYear studentStatus')
      .populate('applicationId', 'studentName applicationId applyingClass status')
      .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId', select: 'name amount pricing mandatory isStockItem currentStock topStock bottomStock' } })
      .populate({ path: 'feeAllocations.studentFeeId', populate: { path: 'feeCategoryId', select: 'name amount pricing mandatory isStockItem currentStock topStock bottomStock' } })
      .populate('recordedById', 'username')
      .sort({ paymentDate: -1 })
      .lean();

    const paymentIds = payments.map(p => p._id);
    const studentIds = payments.map(p => p.studentId?._id).filter(Boolean);
    const [invoices, concessions] = await Promise.all([
      Invoice.find({ paymentId: { $in: paymentIds } })
        .select('invoiceNumber paymentId studentId generatedDate createdAt updatedAt')
        .lean(),
      StudentFeeConcession.find({
        studentId: { $in: studentIds },
        status: { $in: ['Active', 'Inactive', 'Completed', 'Expired'] }
      })
        .select('studentFeeId lessAmount status academicYear academicYearId')
        .lean()
    ]);
    const invoiceMap = {};
    invoices.forEach(inv => {
      invoiceMap[inv.paymentId.toString()] = inv;
    });

    const concessionMap = new Map(concessions.map(c => [c.studentFeeId.toString(), c]));

    const paymentsWithInvoices = payments.map(p => {
      const pObj = { ...p };
      pObj.invoice = invoiceMap[p._id.toString()] || null;
      if (pObj.studentId) {
        pObj.student = pObj.studentId;
      }
      if (pObj.applicationId) {
        pObj.application = pObj.applicationId;
      }
      if (pObj.studentFeeId) {
        pObj.studentFee = pObj.studentFeeId;
        if (pObj.studentFee.feeCategoryId) {
          pObj.studentFee.feeCategory = pObj.studentFee.feeCategoryId;
        }
        applyConcessionSnapshot(pObj.studentFee, concessionMap.get(pObj.studentFee._id.toString()));
      }
      if (pObj.feeAllocations && pObj.feeAllocations.length > 0) {
        pObj.feeAllocations.forEach(alloc => {
          if (alloc.studentFeeId) {
            const concession = concessionMap.get(alloc.studentFeeId._id.toString());
            applyConcessionSnapshot(alloc.studentFeeId, concession);
            alloc.discountAmount = alloc.studentFeeId.discountAmount || 0;
          }
        });
      }
      if (pObj.recordedById) {
        pObj.recordedBy = pObj.recordedById;
      }
      return pObj;
    });

    res.json(paymentsWithInvoices);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching payments' });
  }
};

import SVGtoPDF from 'svg-to-pdfkit';

export const generateInvoicePDF = async (req, res) => {
  try {
    const { id } = req.params;

    const invoiceContext = await getInvoicePaymentData(id);

    if (!invoiceContext) {
      res.status(404).json({ error: 'Payment or invoice not found' });
      return;
    }

    const { payment, invoice, summary } = invoiceContext;
    const groupedRows = groupFeeAllocationsForReceipt(payment);
    const receiptTotals = calculateReceiptTotals(groupedRows);
    const { fullRemainingBalance } = summary;

    const doc = new PDFDocument({
      size: 'A4',
      margins: 0
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice_${invoice.invoiceNumber}.pdf`);

    doc.pipe(res);
    drawReceiptSheet({
      doc,
      payment,
      invoice,
      groupedRows,
      totals: receiptTotals
    });

    if (payment.feeAllocations && payment.feeAllocations.length > 0) {
      doc.info.Title = `Invoice ${invoice.invoiceNumber}`;
      doc.info.Subject = `Receipt balance ${formatReceiptCurrency(fullRemainingBalance)}`;
    }

    doc.end();

  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error generating PDF' });
    }
  }
};

export const getPaymentInvoiceData = async (req, res) => {
  try {
    const { id } = req.params;
    const invoiceContext = await getInvoicePaymentData(id);

    if (!invoiceContext) {
      return res.status(404).json({ error: 'Payment or invoice not found' });
    }

    res.json(invoiceContext);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error fetching invoice data' });
  }
};

export const deletePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await Payment.findById(id);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.feeAllocations && payment.feeAllocations.length > 0) {
      for (const alloc of payment.feeAllocations) {
        await StudentFee.findByIdAndUpdate(alloc.studentFeeId, {
          $inc: { paidAmount: -alloc.amount, remainingAmount: alloc.amount }
        });
      }
    } else if (payment.studentFeeId) {
      await StudentFee.findByIdAndUpdate(payment.studentFeeId, {
        $inc: { paidAmount: -payment.amount, remainingAmount: payment.amount }
      });
    }

    // Restore stock if inventory was processed for this payment
    if (payment.inventoryProcessed) {
      const allocatedFeeIds = payment.feeAllocations && payment.feeAllocations.length > 0
        ? payment.feeAllocations.map(a => a.studentFeeId)
        : (payment.studentFeeId ? [payment.studentFeeId] : []);

      for (const feeId of allocatedFeeIds) {
        const studentFee = await StudentFee.findById(feeId);
        if (studentFee && studentFee.feeCategoryId) {
          const cat = await FeeCategory.findById(studentFee.feeCategoryId);
          if (cat && cat.isStockItem) {
            if (cat.name.toLowerCase() === 'uniform') {
              // Uniform stock is handled upon student details assignment, so deleting a payment does not restore stock.
            } else {
              const updatedCat = await FeeCategory.findOneAndUpdate(
                { _id: cat._id },
                { $inc: { currentStock: 1 } },
                { new: true }
              );

              if (updatedCat) {
                await StockHistory.create({
                  categoryId: cat._id,
                  categoryName: cat.name,
                  previousStock: updatedCat.currentStock - 1,
                  updatedStock: updatedCat.currentStock,
                  difference: 1,
                  action: 'REMOVED',
                  referenceType: 'Payment',
                  referenceId: payment._id,
                  updatedBy: req.user?.id || req.user?._id || req.user?.userId || null
                });

                await StudentFee.findByIdAndUpdate(studentFee._id, {
                  isStockDeducted: false
                });
              }
            }
          }
        }
      }
    }

    await Invoice.deleteMany({ paymentId: id });
    await Payment.findByIdAndDelete(id);

    res.json({ message: 'Payment deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error deleting payment' });
  }
};
