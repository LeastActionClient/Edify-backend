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

  let nextCount = 101;
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

const formatReceiptAmount = (value) => toNumber(value).toFixed(2);
const formatReceiptMoney = (value) => formatReceiptAmount(value);
const formatReceiptCurrency = (value) => formatReceiptAmount(value);
const formatReceiptDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-GB');
};

const RECEIPT_PAGE_WIDTH_MM = 105;
const RECEIPT_PAGE_HEIGHT_MM = 148;
const RECEIPT_MARGIN_MM = 5;
const RECEIPT_INNER_PADDING_MM = 4;
const RECEIPT_FOOTER_HEIGHT_MM = 13;

const RECEIPT_COLORS = {
  orange: '#F58220',
  lightOrange: '#FDE9D9',
  darkGrey: '#555555',
  border: '#ECECEC',
  alternateRow: '#FFF8F2',
  text: '#2F2F2F',
  muted: '#8A8A8A'
};

const getReceiptLogoSource = () => {
  const logoPath = path.resolve(process.cwd(), 'public', 'KSlogo.jpg');
  return fs.existsSync(logoPath) ? logoPath : Buffer.from(logoBase64, 'base64');
};

const drawReceiptField = (doc, { label, value, x, y, width, align = 'left', accent = false }) => {
  const labelText = `${label}`;
  const valueText = value || '-';
  const valueColor = accent ? RECEIPT_COLORS.orange : RECEIPT_COLORS.text;
  const labelFontSize = 6.2;
  const valueFontSize = 7.2;
  const gap = mmToPt(0.8);
  const labelWidth = mmToPt(15.2);
  const colonWidth = doc.widthOfString(':');
  const valueWidth = Math.max(0, width - labelWidth - colonWidth - gap);

  doc.fillColor(RECEIPT_COLORS.darkGrey)
    .font('Helvetica-Bold')
    .fontSize(labelFontSize)
    .text(labelText, x, y, {
      width: labelWidth,
      lineBreak: false,
      ellipsis: true
    });

  doc.text(':', x + labelWidth + mmToPt(0.2), y, {
    width: colonWidth + mmToPt(0.2),
    lineBreak: false
  });

  doc.fillColor(valueColor)
    .font('Helvetica-Bold')
    .fontSize(valueFontSize)
    .text(valueText, x + labelWidth + colonWidth + gap, y, {
      width: valueWidth,
      align: align === 'right' ? 'right' : 'left',
      lineBreak: false,
      ellipsis: true
    });
};

const drawReceiptHeader = ({ doc, innerX, innerY, innerWidth, payment, invoice }) => {
  const student = payment.studentId || payment.student || {};
  const application = payment.applicationId || payment.application || {};
  const isApplication = payment.paymentType === 'APPLICATION';
  const logoWidth = mmToPt(45);
  const logoHeight = mmToPt(23);
  const badgeWidth = mmToPt(20);
  const badgeHeight = mmToPt(10);
  const badgeX = innerX + innerWidth - badgeWidth;
  const receiptDateValue = payment.paymentDate || invoice?.generatedDate || payment.createdAt;
  const paymentModeValue = payment.paymentMethod || payment.paymentMode || payment.mode || '-';

  try {
    doc.image(getReceiptLogoSource(), innerX, innerY + mmToPt(0.8), {
      width: logoWidth,
      height: logoHeight,
      fit: [logoWidth, logoHeight]
    });
  } catch (imageError) {
    console.error('Error loading receipt logo', imageError);
  }

  doc.save();
  doc.roundedRect(badgeX, innerY + mmToPt(1.0), badgeWidth, badgeHeight, mmToPt(4))
    .fillAndStroke(RECEIPT_COLORS.lightOrange, RECEIPT_COLORS.lightOrange);
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(8.4)
    .text('FEE', badgeX, innerY + mmToPt(3.0), {
      width: badgeWidth,
      align: 'center',
      lineBreak: false
    });
  doc.text('RECEIPT', badgeX, innerY + mmToPt(7.0), {
      width: badgeWidth,
      align: 'center',
      lineBreak: false
    });
  doc.restore();

  const approvedY = innerY + mmToPt(25.2);
  doc.fillColor(RECEIPT_COLORS.muted).font('Helvetica').fontSize(8.6)
    .text('Approved by Govt. of Tamilnadu - 2349', innerX, approvedY, {
      width: innerWidth,
      align: 'center',
      lineBreak: false,
      ellipsis: true
    });

  const dividerY = innerY + mmToPt(28.6);
  doc.moveTo(innerX, dividerY).lineTo(innerX + innerWidth, dividerY).lineWidth(0.5).strokeColor(RECEIPT_COLORS.border).stroke();

  const infoTop = dividerY + mmToPt(2.0);
  const colGap = mmToPt(4.0);
  const leftColWidth = mmToPt(39.0);
  const rightColWidth = innerWidth - leftColWidth - colGap;
  const lineGap = mmToPt(5.0);
  const itemHeight = mmToPt(4.2);

  if (isApplication) {
    drawReceiptField(doc, {
      label: 'Ad. No',
      value: application.applicationId || '-',
      x: innerX,
      y: infoTop,
      width: leftColWidth,
      accent: true
    });
    drawReceiptField(doc, {
      label: 'Receipt No',
      value: payment.invoice?.invoiceNumber || payment._id?.toString?.() || '-',
      x: innerX + leftColWidth + colGap,
      y: infoTop,
      width: rightColWidth,
      align: 'right'
    });
    drawReceiptField(doc, {
      label: 'S. Name',
      value: application.studentName || '-',
      x: innerX,
      y: infoTop + lineGap,
      width: leftColWidth,
      accent: true
    });
    drawReceiptField(doc, {
      label: 'Class & Sec',
      value: application.applyingClass || '-',
      x: innerX + leftColWidth + colGap,
      y: infoTop + lineGap,
      width: rightColWidth,
      align: 'right'
    });
    drawReceiptField(doc, {
      label: 'Date',
      value: formatReceiptDate(receiptDateValue),
      x: innerX,
      y: infoTop + lineGap * 2,
      width: leftColWidth
    });
    drawReceiptField(doc, {
      label: 'Payment Mode',
      value: String(paymentModeValue || '-').toUpperCase(),
      x: innerX + leftColWidth + colGap,
      y: infoTop + lineGap * 2,
      width: rightColWidth,
      align: 'right'
    });
  } else {
    drawReceiptField(doc, {
      label: 'Ad. No',
      value: student.admissionNumber || '-',
      x: innerX,
      y: infoTop,
      width: leftColWidth
    });
    drawReceiptField(doc, {
      label: 'Receipt No',
      value: payment.invoice?.invoiceNumber || payment._id?.toString?.() || '-',
      x: innerX + leftColWidth + colGap,
      y: infoTop,
      width: rightColWidth,
      align: 'left'
    });
    drawReceiptField(doc, {
      label: 'S. Name',
      value: student.studentName || '-',
      x: innerX,
      y: infoTop + lineGap,
      width: leftColWidth,
      accent: true
    });
    drawReceiptField(doc, {
      label: 'Date',
      value: formatReceiptDate(receiptDateValue),
      x: innerX + leftColWidth + colGap,
      y: infoTop + lineGap,
      width: rightColWidth,
      align: 'left'
    });
    drawReceiptField(doc, {
      label: 'Class & Sec',
      value: student.currentClass
        ? `${student.currentClass}${student.section ? ` - ${student.section}` : ''}`
        : '-',
      x: innerX,
      y: infoTop + lineGap * 2,
      width: leftColWidth
    });
    drawReceiptField(doc, {
      label: 'Payment Mode',
      value: String(paymentModeValue || '-').toUpperCase(),
      x: innerX + leftColWidth + colGap,
      y: infoTop + lineGap * 2,
      width: rightColWidth,
      align: 'left'
    });
  }

  const infoBottom = infoTop + lineGap * 2 + itemHeight + mmToPt(0.9);
  doc.moveTo(innerX, infoBottom).lineTo(innerX + innerWidth, infoBottom).lineWidth(0.5).strokeColor(RECEIPT_COLORS.border).stroke();

  return {
    infoBottom,
    headerBottom: infoBottom
  };
};

const drawReceiptTable = ({ doc, innerX, innerWidth, topY, groupedRows }) => {
  const hasDiscountColumn = false;
  const rowHeight = groupedRows.length > 4 ? mmToPt(4.7) : mmToPt(5.1);
  const headerHeight = mmToPt(5.6);
  const tableHeight = headerHeight + Math.max(groupedRows.length, 1) * rowHeight;
  const tableRadius = mmToPt(3.5);
  const descWidth = mmToPt(45);
  const totalWidth = mmToPt(14);
  const paidWidth = mmToPt(14);
  const balanceWidth = innerWidth - descWidth - totalWidth - paidWidth;

  doc.save();
  doc.roundedRect(innerX, topY, innerWidth, tableHeight, tableRadius)
    .fillAndStroke('#FFFFFF', RECEIPT_COLORS.border);
  doc.roundedRect(innerX, topY, innerWidth, tableHeight, tableRadius).clip();

  doc.rect(innerX, topY, innerWidth, headerHeight)
    .fillAndStroke(RECEIPT_COLORS.orange, RECEIPT_COLORS.orange);

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5)
    .text('Fee Description', innerX + mmToPt(1.8), topY + mmToPt(1.9), {
      width: descWidth - mmToPt(3),
      ellipsis: true,
      lineBreak: false
    });
  doc.text('Total', innerX + descWidth, topY + mmToPt(1.9), {
    width: totalWidth,
    align: 'right',
    ellipsis: true,
    lineBreak: false
  });
  doc.text('Paid', innerX + descWidth + totalWidth, topY + mmToPt(1.9), {
    width: paidWidth,
    align: 'right',
    ellipsis: true,
    lineBreak: false
  });
  doc.text('Balance', innerX + descWidth + totalWidth + paidWidth, topY + mmToPt(1.9), {
    width: balanceWidth - mmToPt(1.2),
    align: 'right',
    ellipsis: true,
    lineBreak: false
  });

  let rowTop = topY + headerHeight;

  if (groupedRows.length === 0) {
    doc.fillColor(RECEIPT_COLORS.darkGrey).font('Helvetica').fontSize(7.5)
      .text('No fee details available.', innerX, rowTop + mmToPt(2.0), {
        width: innerWidth,
        align: 'center'
      });
  } else {
    groupedRows.forEach((row, index) => {
      const rowY = rowTop + index * rowHeight;
      const fillColor = index % 2 === 0 ? '#FFFFFF' : RECEIPT_COLORS.alternateRow;

      doc.rect(innerX, rowY, innerWidth, rowHeight).fill(fillColor);
      if (index > 0) {
        doc.moveTo(innerX, rowY).lineTo(innerX + innerWidth, rowY).lineWidth(0.4).strokeColor(RECEIPT_COLORS.border).stroke();
      }

      doc.fillColor(RECEIPT_COLORS.text).font('Helvetica-Bold').fontSize(7.5)
        .text(row.displayName, innerX + mmToPt(1.8), rowY + mmToPt(1.2), {
          width: descWidth - mmToPt(3),
          ellipsis: true,
          lineBreak: false
        });
      doc.text(formatReceiptMoney(row.totalAmount), innerX + descWidth, rowY + mmToPt(1.2), {
        width: totalWidth - mmToPt(0.8),
        align: 'right',
        ellipsis: true,
        lineBreak: false
      });
      doc.text(formatReceiptMoney(row.paidAmount), innerX + descWidth + totalWidth, rowY + mmToPt(1.2), {
        width: paidWidth - mmToPt(0.8),
        align: 'right',
        ellipsis: true,
        lineBreak: false
      });
      doc.text(formatReceiptMoney(row.balanceAmount), innerX + descWidth + totalWidth + paidWidth, rowY + mmToPt(1.2), {
        width: balanceWidth - mmToPt(1.2),
        align: 'right',
        ellipsis: true,
        lineBreak: false
      });
    });
  }

  doc.restore();

  return {
    tableBottom: rowTop + Math.max(groupedRows.length, 1) * rowHeight,
    rowHeight
  };
};

const drawReceiptGrandTotal = ({ doc, innerX, innerWidth, topY, amount }) => {
  const summaryWidth = mmToPt(46);
  const summaryHeight = mmToPt(15);
  const summaryX = innerX + innerWidth - summaryWidth;
  const dividerY = topY + mmToPt(6.0);

  doc.save();
  doc.moveTo(innerX, dividerY).lineTo(summaryX - mmToPt(1.0), dividerY).lineWidth(0.45).strokeColor(RECEIPT_COLORS.border).stroke();
  doc.fillColor(RECEIPT_COLORS.orange).font('Helvetica-Bold').fontSize(8.6)
    .text('GRAND TOTAL', summaryX,  topY - mmToPt(4), {
      width: summaryWidth,
      align: 'center',
      lineBreak: false
    });

    doc.roundedRect(
  summaryX,
  topY + mmToPt(1.5),
  summaryWidth,
  summaryHeight,
  mmToPt(2.8)
).fillAndStroke(
  RECEIPT_COLORS.lightOrange,
  RECEIPT_COLORS.lightOrange
);

// Same Y position for both texts
const textY = topY + mmToPt(6);

// Left Label
doc.fillColor(RECEIPT_COLORS.darkGrey)
  .font('Helvetica-Bold')
  .fontSize(7)
  .text(
    'TOTAL AMOUNT',
    summaryX + mmToPt(2),
    textY,
    {
      width: summaryWidth / 2,
      align: 'left',
      lineBreak: false
    }
  );

// Right Amount
doc.fillColor(RECEIPT_COLORS.text)
  .font('Helvetica-Bold')
  .fontSize(10)
  .text(
    `Rs.${formatReceiptMoney(amount)}`,
    summaryX + summaryWidth / 2,
    textY,
    {
      width: summaryWidth / 2 - mmToPt(2),
      align: 'right',
      lineBreak: false
    }
  );

  // doc.roundedRect(summaryX, topY + mmToPt(1.5), summaryWidth, summaryHeight, mmToPt(2.8))
  //   .fillAndStroke(RECEIPT_COLORS.lightOrange, RECEIPT_COLORS.lightOrange);
  // doc.fillColor(RECEIPT_COLORS.darkGrey).font('Helvetica-Bold').fontSize(7)
  //   .text('TOTAL AMOUNT', summaryX + mmToPt(1.6), topY + mmToPt(2.8), {
  //     width: summaryWidth - mmToPt(3.2),
  //     align: 'left',
  //     lineBreak: false
  //   });
  // doc.fillColor(RECEIPT_COLORS.text).font('Helvetica-Bold').fontSize(11)
  //   .text(formatReceiptMoney(amount), summaryX + mmToPt(1.6), topY + mmToPt(6.2), {
  //     width: summaryWidth - mmToPt(3.2),
  //     align: 'right',
  //     lineBreak: false,
  //     ellipsis: true
  //   });
  doc.restore();
};

const drawReceiptFooter = ({ doc, x, y, width, height }) => {
  doc.save();
  doc.rect(x, y, width, height).fill(RECEIPT_COLORS.orange);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.2)
    .text('#15 & 44, Eda Street, Saidapet, Vellore - 632 012. Ph : 0416 - 2211877', x, y + mmToPt(4.4), {
      width,
      align: 'center',
      lineBreak: false,
      ellipsis: true
    });
  doc.restore();
};

const drawReceiptPage = ({
  doc,
  payment,
  invoice,
  groupedRows,
  totals
}) => {
  const pageMargin = mmToPt(RECEIPT_MARGIN_MM);
  const cardX = pageMargin;
  const cardY = pageMargin;
  const cardWidth = mmToPt(RECEIPT_PAGE_WIDTH_MM - RECEIPT_MARGIN_MM * 2);
  const cardHeight = mmToPt(RECEIPT_PAGE_HEIGHT_MM - RECEIPT_MARGIN_MM * 2);
  const innerPadding = mmToPt(RECEIPT_INNER_PADDING_MM);
  const innerX = cardX + innerPadding;
  const innerY = cardY + innerPadding;
  const innerWidth = cardWidth - innerPadding * 2;
  const footerHeight = mmToPt(RECEIPT_FOOTER_HEIGHT_MM);
  const footerY = cardY + cardHeight - footerHeight;

  doc.save();
  doc.roundedRect(cardX, cardY, cardWidth, cardHeight, mmToPt(3.2))
    .fillAndStroke('#FFFFFF', RECEIPT_COLORS.border);
  doc.roundedRect(cardX, cardY, cardWidth, cardHeight, mmToPt(3.2)).clip();

  const headerState = drawReceiptHeader({ doc, innerX, innerY, innerWidth, payment, invoice });
  const tableStart = headerState.infoBottom + mmToPt(2.2);
  const tableState = drawReceiptTable({
    doc,
    innerX,
    innerWidth,
    topY: tableStart,
    groupedRows
  });
  const summaryTop = Math.max(tableState.tableBottom + mmToPt(1.0), footerY - mmToPt(25.5));
  drawReceiptGrandTotal({
    doc,
    innerX,
    innerWidth,
    topY: summaryTop,
    amount: totals.totalAmount
  });
  drawReceiptFooter({
    doc,
    x: cardX,
    y: footerY,
    width: cardWidth,
    height: footerHeight
  });

  doc.restore();
};

const drawReceiptPageShell = ({
  doc,
  payment,
  invoice,
  groupedRows,
  totals
}) => {
  drawReceiptPage({
    doc,
    payment,
    invoice,
    groupedRows,
    totals
  });
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
      size: [mmToPt(RECEIPT_PAGE_WIDTH_MM), mmToPt(RECEIPT_PAGE_HEIGHT_MM)],
      margins: 0
    });

    res.setHeader('Content-Type', 'application/pdf');
    const safeInvoiceNumber = String(invoice.invoiceNumber || payment._id || 'invoice').replace(/[^a-zA-Z0-9._-]/g, '_');
    const safePaymentId = String(payment._id || Date.now()).replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename=invoice_${safeInvoiceNumber}_${safePaymentId}.pdf`);

    doc.pipe(res);
    drawReceiptPageShell({
      doc,
      payment,
      invoice,
      groupedRows,
      totals: receiptTotals
    });

    if (payment.feeAllocations && payment.feeAllocations.length > 0) {
      doc.info.Title = `Invoice ${invoice.invoiceNumber}`;
      doc.info.Subject = `Receipt balance ${formatReceiptAmount(fullRemainingBalance)}`;
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
