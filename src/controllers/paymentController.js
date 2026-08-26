import mongoose from 'mongoose';
import { Student, StudentFee, Payment, Invoice, FeeCategory, ActivityLog, StockHistory, StudentFeeConcession, IncludedCharge, IncludedChargeStockTransaction, Class } from '../models/index.js';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { logoBase64 } from '../utils/logoBase64.js';

import { normalizeIndianMobile } from '../utils/phoneNumber.js';

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
  const feeName = fee.feeCategoryId?.name || fee.includedChargeId?.name || fee.name || 'Fee';
  const totalAmount = toNumber(fee.totalAmount);
  const paidAmount = toNumber(source?.amount ?? fallbackAmount);
  const balanceAmount = toNumber(fee.remainingAmount);
  const lessAmount = toNumber(
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
    lessAmount,
    discountAmount: lessAmount
  };
};

const parsePaymentEntriesForReceipt = (payment) => {
  if (payment?.paymentType === 'APPLICATION') {
    return [{
      rawName: 'Application Fee',
      displayName: 'Application Fee',
      totalAmount: payment.amount,
      lessAmount: 0,
      discountAmount: 0,
      paidAmount: payment.amount,
      balanceAmount: 0
    }];
  }

  const feeAllocations = Array.isArray(payment?.feeAllocations) ? payment.feeAllocations : [];
  const studentFee = payment?.studentFee || payment?.studentFeeId || null;

  return feeAllocations.length > 0
    ? feeAllocations.map((allocation) => buildReceiptEntry(allocation))
    : studentFee
      ? [buildReceiptEntry(studentFee, payment?.amount)]
      : [];
};

const groupEntriesListForReceipt = (entries) => {
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
        lessAmount: 0,
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
    group.lessAmount += entry.lessAmount;
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
      lessAmount: group.lessAmount,
      discountAmount: group.discountAmount,
      paidAmount: group.paidAmount,
      balanceAmount: group.balanceAmount,
      rows: group.rows,
      sortIndex: group.sortIndex
    };
  });
};

const groupFeeAllocationsForReceipt = (payment) => {
  if (payment?.paymentType === 'APPLICATION') {
    return [{
      name: 'Application Fee',
      displayName: 'Application Fee',
      terms: [],
      totalAmount: payment.amount,
      lessAmount: 0,
      discountAmount: 0,
      paidAmount: payment.amount,
      balanceAmount: 0,
      rows: []
    }];
  }

  return groupEntriesListForReceipt(parsePaymentEntriesForReceipt(payment));
};

const calculateReceiptTotals = (groupedRows) =>
  groupedRows.reduce(
    (acc, row) => ({
      totalAmount: acc.totalAmount + toNumber(row.totalAmount),
      lessAmount: acc.lessAmount + toNumber(row.lessAmount ?? row.discountAmount),
      discountAmount: acc.discountAmount + toNumber(row.discountAmount),
      paidAmount: acc.paidAmount + toNumber(row.paidAmount),
      balanceAmount: acc.balanceAmount + toNumber(row.balanceAmount)
    }),
    {
      totalAmount: 0,
      lessAmount: 0,
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
const RECEIPT_INNER_PADDING_MM = 2.5;
const RECEIPT_FOOTER_HEIGHT_MM = 5.5;
const RECEIPT_MAX_ROWS_PER_PAGE = 10;
const RECEIPT_PAGE_GAP_MM = 1.8;
const RECEIPT_SUMMARY_GAP_MM = 1.4;

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

const drawReceiptField = (doc, { label, value, x, y, width, align = 'left', accent = false, valueFontSize = 8.5 }) => {
  const labelText = `${label}`;
  const valueText = value || '-';
  const valueColor = accent ? RECEIPT_COLORS.orange : RECEIPT_COLORS.text;
  const labelFontSize = 8.0;
  const gap = mmToPt(0.8);
  const labelWidth = mmToPt(22.0);
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
  const logoWidth = mmToPt(70);
  const logoHeight = mmToPt(14);
  const badgeWidth = mmToPt(20.5);
  const badgeHeight = mmToPt(10.5);
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
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(9.8)
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

  const approvedY = innerY + badgeHeight + mmToPt(4.0);
  doc.fillColor(RECEIPT_COLORS.muted).font('Helvetica-Bold').fontSize(9.9)
    .text('Approved by Govt. of Tamilnadu - 2349', innerX, approvedY, {
      width: innerWidth,
      align: 'center',
      lineBreak: false,
      ellipsis: true
    });

  const dividerY = innerY + mmToPt(18.6);
  doc.moveTo(innerX, dividerY).lineTo(innerX + innerWidth, dividerY).lineWidth(0.5).strokeColor(RECEIPT_COLORS.border).stroke();

  const infoTop = dividerY + mmToPt(2.0);
  const colGap = mmToPt(4.0);
  const leftColWidth = mmToPt(44.0);
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
      align: 'left'
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
      align: 'left'
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
      align: 'left'
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
      y: infoTop + lineGap - mmToPt(0.3) ,
      width: leftColWidth,
      accent: true,
      valueFontSize: 7.5
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

const drawReceiptTable = ({ doc, innerX, innerWidth, topY, groupedRows, showLessAmount = false }) => {
  const getRowLessAmount = (row) => toNumber(row?.lessAmount ?? row?.discountAmount ?? 0);
  const rowHeight = groupedRows.length > 4 ? mmToPt(5.0) : mmToPt(5.35);
  const headerHeight = mmToPt(6.0);
  const tableHeight = headerHeight + Math.max(groupedRows.length, 1) * rowHeight;
  const tableRadius = mmToPt(3.5);
  const totalWidth = showLessAmount ? mmToPt(10.5) : mmToPt(11.5);
  const lessWidth = showLessAmount ? Math.max(totalWidth, mmToPt(12.5)) : 0;
  const paidWidth = showLessAmount ? mmToPt(10.5) : mmToPt(11.5);
  const balanceWidth = mmToPt(10.5);
  const descWidth = innerWidth - totalWidth - lessWidth - paidWidth - balanceWidth;
  const textPadX = mmToPt(0.5);
  const totalX = innerX + descWidth;
  const lessX = totalX + totalWidth;
  const paidX = lessX + lessWidth;
  const balanceX = paidX + paidWidth;
  const amountFontSize = showLessAmount ? 8.0 : 8.4;
  const lessAmountFontSize = showLessAmount ? 7.4 : amountFontSize;
  const headerFontSize = showLessAmount ? 8.0 : 8.6;

  doc.save();
  doc.roundedRect(innerX, topY, innerWidth, tableHeight, tableRadius)
    .fillAndStroke('#FFFFFF', RECEIPT_COLORS.border);
  doc.roundedRect(innerX, topY, innerWidth, tableHeight, tableRadius).clip();

  doc.rect(innerX, topY, innerWidth, headerHeight)
    .fillAndStroke(RECEIPT_COLORS.orange, RECEIPT_COLORS.orange);

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(headerFontSize)
    .text('Fee Description', innerX + mmToPt(1.8), topY + mmToPt(2.1), {
      width: descWidth - mmToPt(3),
      ellipsis: true,
      lineBreak: false
    });
  doc.text('Total', totalX, topY + mmToPt(2.1), {
    width: totalWidth,
    align: 'center',
    ellipsis: true,
    lineBreak: false
  });
  if (showLessAmount) {
    doc.text('Less', lessX, topY + mmToPt(2.1), {
      width: lessWidth,
      align: 'center',
      ellipsis: true,
      lineBreak: false
    });
  }
  doc.text('Paid', paidX, topY + mmToPt(2.1), {
    width: paidWidth,
    align: 'center',
    ellipsis: true,
    lineBreak: false
  });
  doc.text('Balance', balanceX, topY + mmToPt(2.1), {
    width: balanceWidth,
    align: 'center',
    ellipsis: true,
    lineBreak: false
  });

  let rowTop = topY + headerHeight;

  if (groupedRows.length === 0) {
    doc.fillColor(RECEIPT_COLORS.darkGrey).font('Helvetica-Bold').fontSize(8.5)
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

      doc.fillColor(RECEIPT_COLORS.text).font('Helvetica-Bold').fontSize(amountFontSize)
        .text(row.displayName, innerX + mmToPt(1.8), rowY + mmToPt(1.35), {
          width: descWidth - mmToPt(3),
          ellipsis: true,
          lineBreak: false
        });
      doc.text(formatReceiptMoney(row.totalAmount), totalX + textPadX, rowY + mmToPt(1.35), {
        width: totalWidth - textPadX * 2,
        align: 'right',
        ellipsis: true,
        lineBreak: false
      });
      if (showLessAmount) {
        doc.font('Helvetica-Bold').fontSize(lessAmountFontSize)
          .text(formatReceiptMoney(getRowLessAmount(row)), lessX + textPadX, rowY + mmToPt(1.42), {
          width: lessWidth - textPadX * 2,
          align: 'right',
          ellipsis: true,
          lineBreak: false
        });
        doc.font('Helvetica-Bold').fontSize(amountFontSize);
      }
      doc.text(formatReceiptMoney(row.paidAmount), paidX + textPadX, rowY + mmToPt(1.35), {
        width: paidWidth - textPadX * 2,
        align: 'right',
        ellipsis: true,
        lineBreak: false
      });
      doc.text(formatReceiptMoney(row.balanceAmount), balanceX + textPadX, rowY + mmToPt(1.35), {
        width: balanceWidth - textPadX * 2,
        align: 'right',
        ellipsis: true,
        lineBreak: false
      });
    });
  }

  const tableBottom = rowTop + Math.max(groupedRows.length, 1) * rowHeight;
  const columnEdges = showLessAmount
    ? [
        totalX,
        lessX,
        paidX,
        balanceX
      ]
    : [
        totalX,
        paidX,
        balanceX
      ];

  columnEdges.forEach((x) => {
    doc.moveTo(x, topY).lineTo(x, tableBottom).lineWidth(0.45).strokeColor(RECEIPT_COLORS.border).stroke();
  });

  doc.restore();

  return {
    tableBottom,
    rowHeight
  };
};

const drawReceiptGrandTotal = ({ doc, innerX, innerWidth, topY, amount }) => {
  const summaryWidth = mmToPt(44);
  const summaryHeight = mmToPt(5.5);
  const summaryX = innerX + innerWidth - summaryWidth;
  const dividerY = topY + mmToPt(3.3);

  doc.save();

  // 1. Divider line first
  doc.moveTo(innerX, dividerY).lineTo(summaryX - mmToPt(1.0), dividerY)
    .lineWidth(0.45).strokeColor(RECEIPT_COLORS.border).stroke();

  // 2. Box next
  doc.roundedRect(
    summaryX,
    topY + mmToPt(0.9),
    summaryWidth,
    summaryHeight,
    mmToPt(2.8)
  ).fillAndStroke(
    RECEIPT_COLORS.lightOrange,
    RECEIPT_COLORS.lightOrange
  );

  // 3. GRAND TOTAL label - drawn after box so it stays visible
  doc.fillColor(RECEIPT_COLORS.orange).font('Helvetica-Bold').fontSize(9.9)
    .text('GRAND TOTAL', summaryX, topY - mmToPt(1.4), {
      width: summaryWidth,
      align: 'center',
      lineBreak: false
    });

  // 4. TOTAL AMOUNT + amount - SAME Y now, single line
  const rowY = topY + mmToPt(3.9); // single shared baseline, vertically centered in box

  doc.fillColor(RECEIPT_COLORS.darkGrey)
    .font('Helvetica-Bold')
    .fontSize(7.8)
    .text('TOTAL AMOUNT', summaryX + mmToPt(2), rowY + mmToPt(0.8), {
      width: summaryWidth - mmToPt(4),
      align: 'left',
      lineBreak: false
    });

  doc.fillColor(RECEIPT_COLORS.text)
    .font('Helvetica-Bold')
    .fontSize(9.8)
    .text(`Rs.${formatReceiptMoney(amount)}`, summaryX + mmToPt(2), rowY, {
      width: summaryWidth - mmToPt(4),
      align: 'right',
      lineBreak: false
    });

  doc.restore();
};

// const drawReceiptGrandTotal = ({ doc, innerX, innerWidth, topY, amount }) => {
//   const summaryWidth = mmToPt(49);
//   const summaryHeight = mmToPt(8.6);
//   const summaryX = innerX + innerWidth - summaryWidth;
//   const dividerY = topY + mmToPt(3.3);

//   doc.save();
//   doc.moveTo(innerX, dividerY).lineTo(summaryX - mmToPt(1.0), dividerY).lineWidth(0.45).strokeColor(RECEIPT_COLORS.border).stroke();

//   doc.fillColor(RECEIPT_COLORS.orange).font('Helvetica-Bold').fontSize(8.9)
//     .text('GRAND TOTAL', summaryX, topY - mmToPt(0.8), {
//       width: summaryWidth,
//       align: 'center',
//       lineBreak: false
//     });

//   doc.roundedRect(
//     summaryX,
//     topY + mmToPt(0.9),
//     summaryWidth,
//     summaryHeight,
//     mmToPt(2.8)
//   ).fillAndStroke(
//     RECEIPT_COLORS.lightOrange,
//     RECEIPT_COLORS.lightOrange
//   );

//   const labelY = topY + mmToPt(1.9);
//   const amountY = topY + mmToPt(4.9);

//   doc.fillColor(RECEIPT_COLORS.darkGrey)
//     .font('Helvetica-Bold')
//     .fontSize(6.8)
//     .text('TOTAL AMOUNT', summaryX + mmToPt(2), labelY, {
//       width: summaryWidth - mmToPt(4),
//       align: 'left',
//       lineBreak: false
//     });

//   doc.fillColor(RECEIPT_COLORS.text)
//     .font('Helvetica-Bold')
//     .fontSize(8.8)
//     .text(`Rs.${formatReceiptMoney(amount)}`, summaryX + mmToPt(2), amountY, {
//       width: summaryWidth - mmToPt(4),
//       align: 'right',
//       lineBreak: false
//     });
//   doc.restore();
// };

const drawReceiptFooter = ({ doc, x, y, width, height }) => {
  doc.save();
  doc.rect(x, y, width, height).fill(RECEIPT_COLORS.orange);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.2)
    .text('#15 & 44, Eda Street, Saidapet, Vellore - 632 012. Ph : 0416 - 2211877', x, y + mmToPt(1.5), {
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
  const summaryTop = Math.max(tableState.tableBottom + mmToPt(1.0), footerY - mmToPt(14.5));
  drawReceiptGrandTotal({
    doc,
    innerX,
    innerWidth,
    topY: summaryTop,
    amount: totals.paidAmount
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

export const ACADEMIC_FEE_CATEGORIES = [
  'book fee',
  'term 1',
  'term 2',
  'term 3',
  'tuition term 1',
  'tuition term 2',
  'tuition term 3',
  'abacus term 1',
  'abacus term 2',
  'abacus term 3',
  'term',
  'tuition term',
  'abacus term'
];

export const isAcademicCategory = (feeName) => {
  if (!feeName) return false;
  const normalized = normalizeSpaces(feeName).toLowerCase();

  if (ACADEMIC_FEE_CATEGORIES.includes(normalized)) {
    return true;
  }

  return (
    /^book fee/i.test(normalized) ||
    /^term\s*\d*$/i.test(normalized) ||
    /^tuition\s*term\s*\d*$/i.test(normalized) ||
    /^abacus\s*term\s*\d*$/i.test(normalized)
  );
};

export const getSplitBillsForReceipt = (payment) => {
  const allEntries = parsePaymentEntriesForReceipt(payment);

  const academicEntries = [];
  const additionalEntries = [];

  allEntries.forEach((entry) => {
    if (isAcademicCategory(entry.rawName)) {
      academicEntries.push(entry);
    } else {
      additionalEntries.push(entry);
    }
  });

  const bills = [];

  if (academicEntries.length > 0) {
    const groupedRows = groupEntriesListForReceipt(academicEntries);
    bills.push({
      id: 'academic',
      type: 'ACADEMIC',
      headerTitle: { line1: 'ACADEMIC FEE', line2: 'RECEIPT' },
      entries: academicEntries,
      groupedRows,
      totals: calculateReceiptTotals(groupedRows)
    });
  }

  if (additionalEntries.length > 0) {
    const groupedRows = groupEntriesListForReceipt(additionalEntries);
    bills.push({
      id: 'additional',
      type: 'ADDITIONAL',
      headerTitle: { line1: 'ADDITIONAL CHARGES', line2: 'RECEIPT' },
      entries: additionalEntries,
      groupedRows,
      totals: calculateReceiptTotals(groupedRows)
    });
  }

  if (bills.length === 0) {
    const groupedRows = groupFeeAllocationsForReceipt(payment);
    bills.push({
      id: 'academic',
      type: 'ACADEMIC',
      headerTitle: { line1: 'ACADEMIC FEE', line2: 'RECEIPT' },
      entries: allEntries,
      groupedRows,
      totals: calculateReceiptTotals(groupedRows)
    });
  }

  return bills;
};

const buildReceiptSummaryRows = ({ totals, payment }) => {
  const paidAmount = toNumber(totals?.paidAmount || payment?.amount);

  return [
    { label: 'Paid Amount', value: formatReceiptMoney(paidAmount), accent: false }
  ];
};

const getReceiptInfoGroups = (payment, invoice) => {
  const student = payment.studentId || payment.student || {};
  const application = payment.applicationId || payment.application || {};
  const isApplication = payment.paymentType === 'APPLICATION';
  const receiptDateValue = payment.paymentDate || invoice?.generatedDate || payment.createdAt;
  const paymentModeValue = String(payment.paymentMethod || payment.paymentMode || payment.mode || '-').toUpperCase();
  const receiptNumberValue = payment.invoice?.invoiceNumber || payment._id?.toString?.() || '-';
  const classValue = isApplication
    ? application.applyingClass || '-'
    : student.currentClass
      ? `${student.currentClass}${student.section ? ` - ${student.section}` : ''}`
      : '-';

  return isApplication
    ? [
        [
          { label: 'Application No', value: application.applicationId || '-', accent: true },
          { label: 'Receipt No', value: receiptNumberValue, align: 'right' }
        ],
        [
          { label: 'Applicant Name', value: application.studentName || '-', valueColor: RECEIPT_COLORS.text, valueFontSize: 7.4 },
          { label: 'Applying Class', value: application.applyingClass || '-', align: 'right' }
        ],
        [
          { label: 'Date', value: formatReceiptDate(receiptDateValue) },
          { label: 'Payment Mode', value: paymentModeValue, align: 'right' }
        ]
      ]
    : [
        [
          { label: 'Ad. No', value: student.admissionNumber || '-' },
          { label: 'Receipt No', value: receiptNumberValue, align: 'right' }
        ],
        [
          { label: 'S. Name', value: student.studentName || '-', valueColor: RECEIPT_COLORS.text, valueFontSize: 7.4 },
          { label: 'Date', value: formatReceiptDate(receiptDateValue), align: 'right' }
        ],
        [
          { label: 'Class & Sec', value: classValue },
          { label: 'Payment Mode', value: paymentModeValue, align: 'right' }
        ]
      ];
};

const measureReceiptFieldBlock = (doc, field, width) => {
  const labelFontSize = 7.0;
  const valueFontSize = field.valueFontSize || (field.compact ? 6.9 : 7.35);
  const labelWidth = mmToPt(18.5);
  const gap = mmToPt(0.8);
  const colonWidth = doc.widthOfString(':');
  const valueWidth = Math.max(0, width - labelWidth - colonWidth - gap);
  const valueText = String(field.value || '-');

  doc.font('Helvetica-Bold').fontSize(labelFontSize);
  const labelHeight = doc.currentLineHeight(false);
  doc.font('Helvetica-Bold').fontSize(valueFontSize);
  const valueHeight = doc.heightOfString(valueText, {
    width: valueWidth,
    align: field.align === 'right' ? 'right' : 'left'
  });

  return {
    labelWidth,
    valueWidth,
    colonWidth,
    gap,
    labelHeight,
    valueHeight,
    height: Math.max(labelHeight, valueHeight)
  };
};

const drawReceiptFieldBlock = (doc, field, x, y, width) => {
  const metrics = measureReceiptFieldBlock(doc, field, width);
  const labelText = field.label;
  const valueText = String(field.value || '-');
  const valueColor = field.valueColor || (field.accent ? RECEIPT_COLORS.orange : RECEIPT_COLORS.text);

  doc.fillColor(RECEIPT_COLORS.darkGrey)
    .font('Helvetica-Bold')
    .fontSize(7.0)
    .text(labelText, x, y, {
      width: metrics.labelWidth,
      lineBreak: false,
      ellipsis: true
    });

  doc.text(':', x + metrics.labelWidth + mmToPt(0.2), y, {
    width: metrics.colonWidth + mmToPt(0.2),
    lineBreak: false
  });

  doc.fillColor(valueColor)
    .font('Helvetica-Bold')
    .fontSize(field.valueFontSize || (field.compact ? 6.9 : 7.35))
    .text(valueText, x + metrics.labelWidth + metrics.colonWidth + metrics.gap, y, {
      width: metrics.valueWidth,
      align: field.align === 'right' ? 'right' : 'left',
      lineBreak: true
    });

  return metrics.height;
};

const measureReceiptHeaderHeight = (doc, { payment, invoice, innerWidth }) => {
  const groups = getReceiptInfoGroups(payment, invoice);
  const leftColWidth = mmToPt(40.8);
  const colGap = mmToPt(4.0);
  const rightColWidth = innerWidth - leftColWidth - colGap;
  const infoTop = mmToPt(18.6) + mmToPt(2.0);
  const rowGap = mmToPt(1.2);

  const rowHeights = groups.map((pair) => {
    const leftMetrics = measureReceiptFieldBlock(doc, pair[0], leftColWidth);
    const rightMetrics = measureReceiptFieldBlock(doc, pair[1], rightColWidth);
    return Math.max(leftMetrics.height, rightMetrics.height);
  });

  return infoTop + rowHeights.reduce((sum, height, index) => sum + height + (index > 0 ? rowGap : 0), 0) + mmToPt(1.0);
};

const drawReceiptHeaderV2 = ({ doc, innerX, innerY, innerWidth, payment, invoice, headerTitle }) => {
  const logoWidth = mmToPt(70);
  const logoHeight = mmToPt(14);
  const line1 = headerTitle?.line1 || 'FEE';
  const line2 = headerTitle?.line2 || 'RECEIPT';

  doc.font('Helvetica-Bold').fontSize(8.8);
  const line1Width = doc.widthOfString(line1);
  const line2Width = doc.widthOfString(line2);
  const textWidth = Math.max(line1Width, line2Width);
  const badgeWidth = Math.max(mmToPt(20.5), textWidth + mmToPt(6.0));
  const badgeHeight = mmToPt(10.5);
  const badgeX = innerX + innerWidth - badgeWidth;

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
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(8.8)
    .text(line1, badgeX, innerY + mmToPt(3.0), {
      width: badgeWidth,
      align: 'center',
      lineBreak: false
    });
  doc.text(line2, badgeX, innerY + mmToPt(7.0), {
    width: badgeWidth,
    align: 'center',
    lineBreak: false
  });
  doc.restore();

  const approvedY = innerY + badgeHeight + mmToPt(4.0);
  doc.fillColor(RECEIPT_COLORS.muted).font('Helvetica').fontSize(8.8)
    .text('Approved by Govt. of Tamilnadu - 2349', innerX, approvedY, {
      width: innerWidth,
      align: 'center',
      lineBreak: false,
      ellipsis: true
    });

  const dividerY = innerY + mmToPt(18.6);
  doc.moveTo(innerX, dividerY).lineTo(innerX + innerWidth, dividerY).lineWidth(0.5).strokeColor(RECEIPT_COLORS.border).stroke();

  const infoTop = dividerY + mmToPt(2.0);
  const colGap = mmToPt(4.0);
  const leftColWidth = mmToPt(40.8);
  const rightColWidth = innerWidth - leftColWidth - colGap;
  const rowGap = mmToPt(1.2);
  const groups = getReceiptInfoGroups(payment, invoice);
  const rowHeights = [];

  let currentY = infoTop;
  groups.forEach((pair, index) => {
    const leftHeight = drawReceiptFieldBlock(doc, pair[0], innerX, currentY, leftColWidth);
    const rightHeight = drawReceiptFieldBlock(doc, pair[1], innerX + leftColWidth + colGap, currentY, rightColWidth);
    const rowHeight = Math.max(leftHeight, rightHeight);
    rowHeights.push(rowHeight);
    currentY += rowHeight + (index < groups.length - 1 ? rowGap : 0);
  });

  const infoBottom = currentY + mmToPt(1.0);
  doc.moveTo(innerX, infoBottom).lineTo(innerX + innerWidth, infoBottom).lineWidth(0.5).strokeColor(RECEIPT_COLORS.border).stroke();

  return {
    infoBottom,
    headerBottom: infoBottom
  };
};

const measureReceiptTableColumns = (doc, groupedRows, innerWidth, showLessAmount = false) => {
  const paddingX = mmToPt(1.6);
  const headerFontSize = 7.0;
  const amountFontSize = 6.9;

  doc.font('Helvetica-Bold').fontSize(headerFontSize);
  const totalSamples = ['Total', ...groupedRows.map((row) => formatReceiptMoney(row.totalAmount))];
  const lessSamples = ['Less', ...groupedRows.map((row) => formatReceiptMoney(row.lessAmount ?? row.discountAmount ?? 0))];
  const paidSamples = ['Paid', ...groupedRows.map((row) => formatReceiptMoney(row.paidAmount))];
  const balanceSamples = ['Balance', ...groupedRows.map((row) => formatReceiptMoney(row.balanceAmount))];

  const totalWidth = Math.max(...totalSamples.map((value) => doc.widthOfString(String(value))), mmToPt(9.5)) + paddingX * 2;
  const paidWidth = Math.max(...paidSamples.map((value) => doc.widthOfString(String(value))), mmToPt(9.5)) + paddingX * 2;
  const balanceWidth = Math.max(...balanceSamples.map((value) => doc.widthOfString(String(value))), mmToPt(9.5)) + paddingX * 2;
  const minDescriptionWidth = mmToPt(36);
  const lessWidth = showLessAmount
    ? Math.max(...lessSamples.map((value) => doc.widthOfString(String(value))), mmToPt(9.5)) + paddingX * 2
    : 0;
  const availableDescriptionWidth = innerWidth - totalWidth - lessWidth - paidWidth - balanceWidth;
  const descriptionWidth = Math.max(availableDescriptionWidth, minDescriptionWidth);
  const extraSpace = innerWidth - (descriptionWidth + totalWidth + lessWidth + paidWidth + balanceWidth);

  return {
    descriptionWidth: descriptionWidth + extraSpace,
    totalWidth,
    lessWidth,
    paidWidth,
    balanceWidth,
    paddingX,
    headerFontSize,
    amountFontSize
  };
};

const measureReceiptRowHeight = (doc, row, columns) => {
  const descPaddingY = mmToPt(0.95);
  const descPaddingX = mmToPt(1.2);
  const descriptionWidth = Math.max(0, columns.descriptionWidth - descPaddingX * 2);
  doc.font('Helvetica-Bold').fontSize(columns.amountFontSize);
  const amountLineHeight = doc.heightOfString('0.00', {
    width: columns.totalWidth - columns.paddingX * 2,
    align: 'right'
  });
  const descHeight = doc.heightOfString(String(row.displayName || '-'), {
    width: descriptionWidth,
    align: 'left'
  });
  return Math.max(mmToPt(5.1), descHeight + descPaddingY * 3, amountLineHeight + descPaddingY * 2);
};

const paginateReceiptRows = (doc, groupedRows, columns, availableHeight) => {
  const pages = [];
  let currentPage = [];
  let currentHeight = 0;

  groupedRows.forEach((row) => {
    const rowHeight = measureReceiptRowHeight(doc, row, columns);
    const exceedsCount = currentPage.length >= RECEIPT_MAX_ROWS_PER_PAGE;
    const exceedsHeight = currentPage.length > 0 && currentHeight + rowHeight > availableHeight;

    if (currentPage.length > 0 && (exceedsCount || exceedsHeight)) {
      pages.push(currentPage);
      currentPage = [];
      currentHeight = 0;
    }

    currentPage.push({ ...row, _rowHeight: rowHeight });
    currentHeight += rowHeight;
  });

  if (currentPage.length > 0 || pages.length === 0) {
    pages.push(currentPage);
  }

  return pages;
};

const measureReceiptSummaryHeight = () => mmToPt(11.0);

const drawReceiptTablePage = ({ doc, innerX, innerWidth, topY, rows, columns, showLessAmount = false }) => {
  const headerHeight = mmToPt(6.2);
  const tableRadius = mmToPt(3.5);
  const descX = innerX;
  const totalX = descX + columns.descriptionWidth;
  const lessX = totalX + columns.totalWidth;
  const paidX = showLessAmount ? lessX + columns.lessWidth : totalX + columns.totalWidth;
  const balanceX = paidX + columns.paidWidth;

  doc.save();
  doc.roundedRect(innerX, topY, innerWidth, 0, tableRadius)
    .fillAndStroke('#FFFFFF', RECEIPT_COLORS.border);
  
  doc.rect(innerX, topY, innerWidth, headerHeight)
    .fillAndStroke(RECEIPT_COLORS.orange, RECEIPT_COLORS.orange);

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(columns.headerFontSize)
    .text('Fee Description', innerX + columns.paddingX, topY + mmToPt(2.0), {
      width: columns.descriptionWidth - columns.paddingX * 2,
      lineBreak: false,
      ellipsis: true
    });
  doc.text('Total', totalX, topY + mmToPt(2.0), {
    width: columns.totalWidth,
    align: 'center',
    lineBreak: false,
    ellipsis: true
  });
  if (showLessAmount) {
    doc.text('Less', lessX, topY + mmToPt(2.0), {
      width: columns.lessWidth,
      align: 'center',
      lineBreak: false,
      ellipsis: true
    });
  }
  doc.text('Paid', paidX, topY + mmToPt(2.0), {
    width: columns.paidWidth,
    align: 'center',
    lineBreak: false,
    ellipsis: true
  });
  doc.text('Balance', balanceX, topY + mmToPt(2.0), {
    width: columns.balanceWidth,
    align: 'center',
    lineBreak: false,
    ellipsis: true
  });

  let rowTop = topY + headerHeight;

  if (rows.length === 0) {
    doc.fillColor(RECEIPT_COLORS.darkGrey).font('Helvetica').fontSize(7.3)
      .text('No fee details available.', innerX, rowTop + mmToPt(2.0), {
        width: innerWidth,
        align: 'center',
        lineBreak: false
      });
    rowTop += mmToPt(6.0);
  } else {
    rows.forEach((row, index) => {
      const rowHeight = row._rowHeight || measureReceiptRowHeight(doc, row, columns);
      const isEven = index % 2 === 0;
      if (!isEven) {
        doc.rect(innerX, rowTop, innerWidth, rowHeight)
          .fill('#FAFAFA');
      }

      doc.moveTo(innerX, rowTop + rowHeight)
        .lineTo(innerX + innerWidth, rowTop + rowHeight)
        .lineWidth(0.4)
        .strokeColor(RECEIPT_COLORS.border)
        .stroke();

      const descPaddingY = mmToPt(0.95);
      const descPaddingX = mmToPt(1.2);
      doc.fillColor(RECEIPT_COLORS.text).font('Helvetica-Bold').fontSize(columns.amountFontSize)
        .text(String(row.displayName || '-'), innerX + descPaddingX, rowTop + descPaddingY, {
          width: columns.descriptionWidth - descPaddingX * 2,
          align: 'left'
        });

      const amountTextY = rowTop + (rowHeight - columns.amountFontSize) / 2 - mmToPt(0.5);

      doc.text(formatReceiptMoney(row.totalAmount), totalX + columns.paddingX, amountTextY, {
        width: columns.totalWidth - columns.paddingX * 2,
        align: 'right',
        lineBreak: false
      });

      if (showLessAmount) {
        doc.text(formatReceiptMoney(row.lessAmount ?? row.discountAmount ?? 0), lessX + columns.paddingX, amountTextY, {
          width: columns.lessWidth - columns.paddingX * 2,
          align: 'right',
          lineBreak: false
        });
      }

      doc.text(formatReceiptMoney(row.paidAmount), paidX + columns.paddingX, amountTextY, {
        width: columns.paidWidth - columns.paddingX * 2,
        align: 'right',
        lineBreak: false
      });

      doc.text(formatReceiptMoney(row.balanceAmount), balanceX + columns.paddingX, amountTextY, {
        width: columns.balanceWidth - columns.paddingX * 2,
        align: 'right',
        lineBreak: false
      });

      rowTop += rowHeight;
    });
  }

  doc.restore();

  return {
    tableBottom: rowTop
  };
};

const drawReceiptSummaryPage = ({ doc, innerX, innerWidth, topY, totals, payment }) => {
  const summaryRows = buildReceiptSummaryRows({ totals, payment });
  const summaryWidth = innerWidth;
  const summaryX = innerX;
  const paddingX = mmToPt(2.8);
  const paddingY = mmToPt(2.0);
  const titleGap = mmToPt(1.2);
  const rowGap = mmToPt(0.8);
  const rowHeight = mmToPt(3.4);
  const boxHeight = paddingY * 2 + titleGap + summaryRows.length * rowHeight + Math.max(0, summaryRows.length - 1) * rowGap;
  const titleY = topY - mmToPt(2.3);

  doc.save();
  doc.roundedRect(summaryX, topY, summaryWidth, boxHeight, mmToPt(2.8))
    .fillAndStroke(RECEIPT_COLORS.lightOrange, RECEIPT_COLORS.lightOrange);

  doc.fillColor(RECEIPT_COLORS.orange).font('Helvetica-Bold').fontSize(8.7)
    .text('SUMMARY', summaryX, titleY, {
      width: summaryWidth,
      align: 'center',
      lineBreak: false
    });

  let rowY = topY + paddingY;
  summaryRows.forEach((row) => {
    doc.fillColor(RECEIPT_COLORS.darkGrey).font('Helvetica-Bold').fontSize(6.9)
      .text(row.label.toUpperCase(), summaryX + paddingX, rowY + mmToPt(0.4), {
        width: summaryWidth - paddingX * 2,
        align: 'left',
        lineBreak: false
      });
    doc.fillColor(row.accent ? RECEIPT_COLORS.orange : RECEIPT_COLORS.text)
      .font('Helvetica-Bold')
      .fontSize(8.4)
      .text(`Rs. ${row.value}`, summaryX + paddingX, rowY, {
        width: summaryWidth - paddingX * 2,
        align: 'right',
        lineBreak: false
      });
    rowY += rowHeight + rowGap;
  });

  doc.restore();
  return {
    summaryBottom: topY + boxHeight
  };
};

const drawReceiptPdfDocument = ({
  doc,
  payment,
  invoice,
  groupedRows,
  totals,
  headerTitle,
  isFirstPageInDoc = true
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
  const summaryHeight = measureReceiptSummaryHeight();

  const showLessAmount = groupedRows.some((row) => toNumber(row?.lessAmount ?? row?.discountAmount) > 0);
  const headerHeight = measureReceiptHeaderHeight(doc, { payment, invoice, innerWidth });
  const columns = measureReceiptTableColumns(doc, groupedRows, innerWidth, showLessAmount);
  const tableTop = innerY + headerHeight + mmToPt(RECEIPT_PAGE_GAP_MM);
  const availableRowsHeight = Math.max(
    mmToPt(18),
    footerY - tableTop - summaryHeight - mmToPt(RECEIPT_SUMMARY_GAP_MM)
  );
  const pages = paginateReceiptRows(doc, groupedRows, columns, availableRowsHeight);
  const totalPages = pages.length || 1;

  pages.forEach((rows, pageIndex) => {
    if (!isFirstPageInDoc || pageIndex > 0) {
      doc.addPage({
        size: [mmToPt(RECEIPT_PAGE_WIDTH_MM), mmToPt(RECEIPT_PAGE_HEIGHT_MM)],
        margin: 0
      });
    }

    doc.save();
    doc.roundedRect(cardX, cardY, cardWidth, cardHeight, mmToPt(3.2))
      .fillAndStroke('#FFFFFF', RECEIPT_COLORS.border);
    doc.roundedRect(cardX, cardY, cardWidth, cardHeight, mmToPt(3.2)).clip();

    const headerState = drawReceiptHeaderV2({ doc, innerX, innerY, innerWidth, payment, invoice, headerTitle });
    const pageTableTop = headerState.infoBottom + mmToPt(RECEIPT_PAGE_GAP_MM);
    const tableState = drawReceiptTablePage({
      doc,
      innerX,
      innerWidth,
      topY: pageTableTop,
      rows,
      columns,
      showLessAmount
    });

    if (pageIndex === totalPages - 1) {
      const summaryTop = Math.max(
        tableState.tableBottom + mmToPt(RECEIPT_SUMMARY_GAP_MM),
        footerY - summaryHeight - mmToPt(2.0)
      );
      drawReceiptSummaryPage({
        doc,
        innerX,
        innerWidth,
        topY: summaryTop,
        totals,
        payment
      });
    }

    drawReceiptFooter({
      doc,
      x: cardX,
      y: footerY,
      width: cardWidth,
      height: footerHeight
    });

    doc.restore();
  });
};

const getInvoicePaymentData = async (id) => {
  const [paymentDoc, invoiceDoc] = await Promise.all([
    Payment.findById(id)
      .populate('studentId', 'studentName admissionNumber currentClass section academicYear studentStatus fatherPhone motherPhone whatsappNumber emisNo emisNumber guardianName guardian')
      .populate('applicationId', 'studentName applicationId applyingClass status feePaid feeAmount feePaidDate fatherPhone motherPhone guardianPhone')
      .populate({ path: 'studentFeeId', populate: [{ path: 'feeCategoryId', select: 'name amount pricing mandatory isStockItem currentStock topStock bottomStock' }, { path: 'includedChargeId', select: 'name amount stockQuantity status' }] })
      .populate({ path: 'feeAllocations.studentFeeId', populate: [{ path: 'feeCategoryId', select: 'name amount pricing mandatory isStockItem currentStock topStock bottomStock' }, { path: 'includedChargeId', select: 'name amount stockQuantity status' }] })
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
    const { studentId, studentFeeIds, amount, feeAllocations: clientAllocations, paymentMethod, referenceNumber, remarks, otherFees } = req.body;

    let targetAllocations = [];
    let resolvedFeeIds = studentFeeIds || [];

    // Dynamically create StudentFee records for Other Fees
    if (otherFees && Array.isArray(otherFees) && otherFees.length > 0) {
      const student = await Student.findById(studentId).session(session);
      for (const of of otherFees) {
        if (!of.includedChargeId || !of.amount) continue;
        const chargeDoc = await IncludedCharge.findById(of.includedChargeId).session(session);
        const originalAmount = chargeDoc ? parseFloat(chargeDoc.amount || 0) : parseFloat(of.amount);
        const amt = parseFloat(of.amount);
        const [newFee] = await StudentFee.create([{
          studentId,
          includedChargeId: of.includedChargeId,
          totalAmount: originalAmount,
          remainingAmount: originalAmount,
          paidAmount: 0,
          className: student?.currentClass,
          academicYear: student?.academicYear
        }], { session });
        
        resolvedFeeIds.push(newFee._id.toString());
        if (clientAllocations) {
          clientAllocations.push({
            studentFeeId: newFee._id.toString(),
            amount: amt
          });
        }
      }
    }

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

    // Enforce Sequential Payment Rule per fee category sequence
    const parseTermInfo = (categoryName) => {
      const name = String(categoryName || '').trim();
      const match = name.match(/term\s*(\d+)/i) || name.match(/\bt(\d+)\b/i) || name.match(/(\d+)(?:st|nd|rd|th)?\s*term/i);
      if (!match) {
        return { isTerm: false, baseCategory: name, termNumber: 0 };
      }
      const termNumber = parseInt(match[1], 10);
      let baseCategory = name.replace(match[0], '').replace(/[-_()\s]+/g, ' ').trim();
      if (!baseCategory) {
        baseCategory = 'General Term';
      }
      return { isTerm: true, baseCategory: baseCategory.toLowerCase(), termNumber };
    };

    const allStudentFees = await StudentFee.find({ studentId }).populate('feeCategoryId').session(session);

    const isPrevFee = (f) => (f.academicYear && student.academicYear && f.academicYear !== student.academicYear) || (!f.academicYear && f.className && student.currentClass && f.className !== student.currentClass);

    const unselectedPreviousYearPending = allStudentFees.filter(sf => {
      if (!isPrevFee(sf)) return false;
      const remaining = sf.remainingAmount || 0;
      if (remaining <= 0) return false;
      const alloc = targetAllocations.find(a => a.studentFeeId === sf._id.toString());
      const allocAmt = alloc ? (parseFloat(alloc.amount) || 0) : 0;
      return (remaining - allocAmt) > 0;
    });

    if (unselectedPreviousYearPending.length > 0) {
      const hasCurrentYearInPayment = unpaidFees.some(fee => !isPrevFee(fee));
      if (hasCurrentYearInPayment) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          error: 'Please clear all previous class pending fees before paying current class fees.'
        });
      }
    }

    for (const fee of unpaidFees) {
      const catName = fee.feeCategoryId?.name || '';
      const termInfo = parseTermInfo(catName);

      if (termInfo.isTerm) {
        const previousTermFees = allStudentFees.filter(otherFee => {
          if (otherFee._id.toString() === fee._id.toString()) return false;

          const feeYear = fee.academicYear || '';
          const otherYear = otherFee.academicYear || '';
          const feeClass = fee.className || '';
          const otherClass = otherFee.className || '';

          const sameYear = (!feeYear || !otherYear) || (feeYear === otherYear);
          const sameClass = (!feeClass || !otherClass) || (feeClass === otherClass);

          if (!sameYear || !sameClass) return false;

          const otherCatName = otherFee.feeCategoryId?.name || '';
          const otherTermInfo = parseTermInfo(otherCatName);
          return otherTermInfo.isTerm &&
                 otherTermInfo.baseCategory === termInfo.baseCategory &&
                 otherTermInfo.termNumber < termInfo.termNumber;
        });

        for (const prevFee of previousTermFees) {
          const prevFeeId = prevFee._id.toString();
          const prevRemaining = prevFee.remainingAmount;
          
          const alloc = targetAllocations.find(a => a.studentFeeId === prevFeeId);
          const allocAmt = alloc ? (parseFloat(alloc.amount) || 0) : 0;
          const remainingAfter = Math.max(0, prevRemaining - allocAmt);

          if (remainingAfter > 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
              error: 'Please complete payment for the previous term before paying this term.'
            });
          }
        }
      }
    }

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
      if (!studentFee || studentFee.isStockDeducted) continue;
      
      if (studentFee.includedChargeId) {
        const charge = await IncludedCharge.findById(studentFee.includedChargeId).session(session);
        if (charge) {
          const updatedCharge = await IncludedCharge.findOneAndUpdate(
            { _id: charge._id, stockQuantity: { $gte: 1 } },
            { $inc: { stockQuantity: -1 } },
            { new: true, session }
          );

          if (!updatedCharge) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ error: `Insufficient stock for ${charge.name}.` });
          }

          await IncludedChargeStockTransaction.create([{
            includedChargeId: charge._id,
            type: 'OUT',
            quantity: 1,
            previousStock: charge.stockQuantity,
            newStock: updatedCharge.stockQuantity,
            reason: 'Payment collected',
            referenceType: 'Payment',
            referenceId: payment._id,
            recordedById: req.user?.id || req.user?._id || req.user?.userId || null
          }], { session });

          await StudentFee.findByIdAndUpdate(studentFee._id, { isStockDeducted: true }, { session });
        }
      } else if (studentFee.feeCategoryId) {
        const cat = await FeeCategory.findById(studentFee.feeCategoryId).session(session);
        if (cat && cat.isStockItem) {
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
      .populate('studentId', 'studentName admissionNumber currentClass section academicYear studentStatus fatherPhone motherPhone whatsappNumber emisNo emisNumber guardianName guardian')
      .populate('applicationId', 'studentName applicationId applyingClass status feePaid feeAmount feePaidDate fatherPhone motherPhone guardianPhone')
      .populate({ path: 'studentFeeId', populate: [{ path: 'feeCategoryId', select: 'name amount pricing mandatory isStockItem currentStock topStock bottomStock' }, { path: 'includedChargeId', select: 'name amount stockQuantity status' }] })
      .populate({ path: 'feeAllocations.studentFeeId', populate: [{ path: 'feeCategoryId', select: 'name amount pricing mandatory isStockItem currentStock topStock bottomStock' }, { path: 'includedChargeId', select: 'name amount stockQuantity status' }] })
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
    const downloadMode = String(req.query.download ?? 'true').toLowerCase();
    const shouldDownload = !['false', '0', 'no', 'inline'].includes(downloadMode);

    const invoiceContext = await getInvoicePaymentData(id);

    if (!invoiceContext) {
      res.status(404).json({ error: 'Payment or invoice not found' });
      return;
    }

    const { payment, invoice, summary } = invoiceContext;
    let splitBills = getSplitBillsForReceipt(payment);
    
    const requestedBill = req.query.bill;
    if (requestedBill === 'first' && splitBills.length > 0) {
      splitBills = [splitBills[0]];
    } else if (requestedBill === 'academic') {
      splitBills = splitBills.filter(b => b.id === 'academic');
    } else if (requestedBill === 'additional') {
      splitBills = splitBills.filter(b => b.id === 'additional');
    }

    if (splitBills.length === 0) {
      // Fallback if filter excluded everything
      splitBills = getSplitBillsForReceipt(payment);
    }

    const { fullRemainingBalance } = summary;

    const doc = new PDFDocument({
      size: [mmToPt(RECEIPT_PAGE_WIDTH_MM), mmToPt(RECEIPT_PAGE_HEIGHT_MM)],
      margins: 0
    });

    res.setHeader('Content-Type', 'application/pdf');
    const safeInvoiceNumber = String(invoice.invoiceNumber || payment._id || 'invoice').replace(/[^a-zA-Z0-9._-]/g, '_');
    const safePaymentId = String(payment._id || Date.now()).replace(/[^a-zA-Z0-9._-]/g, '_');
    const dispositionType = shouldDownload ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${dispositionType}; filename=invoice_${safeInvoiceNumber}_${safePaymentId}.pdf`);

    doc.pipe(res);

    splitBills.forEach((bill, index) => {
      drawReceiptPdfDocument({
        doc,
        payment,
        invoice,
        groupedRows: bill.groupedRows,
        totals: bill.totals,
        headerTitle: bill.headerTitle,
        isFirstPageInDoc: index === 0
      });
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
        if (!studentFee || !studentFee.isStockDeducted) continue;
        
        if (studentFee.includedChargeId) {
          const charge = await IncludedCharge.findById(studentFee.includedChargeId);
          if (charge) {
            const updatedCharge = await IncludedCharge.findOneAndUpdate(
              { _id: charge._id },
              { $inc: { stockQuantity: 1 } },
              { new: true }
            );

            if (updatedCharge) {
              await IncludedChargeStockTransaction.create({
                includedChargeId: charge._id,
                type: 'IN',
                quantity: 1,
                previousStock: charge.stockQuantity,
                newStock: updatedCharge.stockQuantity,
                reason: 'Payment deleted',
                referenceType: 'Payment',
                referenceId: payment._id,
                recordedById: req.user?.id || req.user?._id || req.user?.userId || null
              });

              await StudentFee.findByIdAndUpdate(studentFee._id, { isStockDeducted: false });
            }
          }
        } else if (studentFee.feeCategoryId) {
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

export const sharePaymentWhatsApp = async (req, res) => {
  try {
    const { id } = req.params;
    const paymentDoc = await Payment.findById(id)
      .populate('studentId')
      .populate('applicationId')
      .lean();

    if (!paymentDoc) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const student = paymentDoc.studentId || paymentDoc.applicationId || {};
    const rawNumber = student.whatsappNumber || student.fatherPhone || student.motherPhone || student.guardianPhone || '';
    
    if (!rawNumber) {
      return res.status(400).json({ error: 'Parent WhatsApp number is not available.' });
    }
    
    const parsed = normalizeIndianMobile(rawNumber);
    if (!parsed.ok) {
       return res.status(400).json({ error: 'Invalid phone number format.' });
    }

    const name = student.studentName || 'Student';
    const amount = paymentDoc.amount;
    let backendUrl = process.env.API_URL || `${req.protocol}://${req.get('host')}`;
    
    // WhatsApp's link parser ignores "localhost". For local testing, we replace it with "lvh.me" 
    // (a standard loopback domain that resolves to 127.0.0.1) so WhatsApp formats it as a clickable link.
    if (backendUrl.includes('localhost')) {
      backendUrl = backendUrl.replace('localhost', 'lvh.me');
    }

    const publicPdfUrl = `${backendUrl}/api/payments/public-invoice/${id}?download=inline&bill=first`;
    const message = `Dear Parent, we have received a payment for ${name}. Thank you. - Kasthuri School\n\nYou can view and download your receipt here:\n${publicPdfUrl}`;
    
    const waLink = `https://wa.me/${parsed.number}?text=${encodeURIComponent(message)}`;
    
    res.json({
      waLink,
      pdfUrl: `/payments/invoice/${id}`,
      message,
      bill: {
         receiptNumber: paymentDoc._id.toString()
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to prepare the WhatsApp bill.' });
  }
};

