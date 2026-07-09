import { Student, StudentFee, Payment, Invoice, FeeCategory, ActivityLog } from '../models/index.js';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

const generateInvoiceNumber = async () => {
  const count = await Invoice.countDocuments();
  return `INV-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;
};

export const createPayment = async (req, res) => {
  try {
    const { studentId, studentFeeId, amount, paymentMethod, referenceNumber, remarks } = req.body;

    if (studentFeeId === 'FULL') {
      const unpaidFees = await StudentFee.find({ studentId, remainingAmount: { $gt: 0 } });
      const totalRemaining = unpaidFees.reduce((sum, f) => sum + f.remainingAmount, 0);
      
      if (amount > totalRemaining) {
        return res.status(400).json({ error: 'Amount exceeds total remaining balance' });
      }
      
      let amountLeftToDistribute = amount;
      const feeAllocations = [];
      
      for (const fee of unpaidFees) {
        if (amountLeftToDistribute <= 0) break;
        
        const paymentAmountForFee = Math.min(amountLeftToDistribute, fee.remainingAmount);
        amountLeftToDistribute -= paymentAmountForFee;
        feeAllocations.push({ studentFeeId: fee._id, amount: paymentAmountForFee });
        
        const newRemainingAmount = fee.remainingAmount - paymentAmountForFee;
        const newPaidAmount = fee.paidAmount + paymentAmountForFee;
        const feeStatus = newRemainingAmount === 0 ? 'PAID' : 'PARTIAL';
        
        await StudentFee.findByIdAndUpdate(fee._id, {
          paidAmount: newPaidAmount,
          remainingAmount: newRemainingAmount
        });
        
        if (feeStatus === 'PAID') {
          const category = await FeeCategory.findById(fee.feeCategoryId);
          if (category && category.name.toLowerCase().includes('full')) {
            await StudentFee.updateMany(
              { studentId, _id: { $ne: fee._id }, remainingAmount: { $gt: 0 } },
              { remainingAmount: 0 }
            );
          }
        }
      }

      const payment = await Payment.create({
        studentId,
        isFullPayment: true,
        feeAllocations,
        amount,
        paymentMethod,
        referenceNumber,
        remarks,
        status: amount === totalRemaining ? 'PAID' : 'PARTIAL',
        recordedById: req.user.id
      });
      
      const invNum = await generateInvoiceNumber();
      const invoice = await Invoice.create({
        invoiceNumber: invNum,
        paymentId: payment._id,
        studentId
      });
      
      await ActivityLog.create({
        userId: req.user.id,
        action: 'CREATED_PAYMENT',
        details: `Full Payment of ${amount} recorded for student ${studentId} covering multiple fees`
      });
      
      return res.status(201).json({ message: 'Full payment processed', payments: [{ ...payment.toObject(), invoice }] });
    }

    const studentFee = await StudentFee.findById(studentFeeId);

    if (!studentFee) {
      res.status(404).json({ error: 'Student fee record not found' });
      return;
    }

    if (amount > studentFee.remainingAmount) {
      res.status(400).json({ error: 'Amount exceeds remaining balance' });
      return;
    }

    const newRemainingAmount = studentFee.remainingAmount - amount;
    const newPaidAmount = studentFee.paidAmount + amount;
    const feeStatus = newRemainingAmount === 0 ? 'PAID' : 'PARTIAL';

    const payment = await Payment.create({
      studentId,
      studentFeeId,
      amount,
      paymentMethod,
      referenceNumber,
      remarks,
      status: feeStatus,
      recordedById: req.user.id
    });

    await StudentFee.findByIdAndUpdate(studentFeeId, {
      paidAmount: newPaidAmount,
      remainingAmount: newRemainingAmount
    });

    const invoiceNumber = await generateInvoiceNumber();

    const invoice = await Invoice.create({
      invoiceNumber,
      paymentId: payment._id,
      studentId
    });

    if (feeStatus === 'PAID') {
      const category = await FeeCategory.findById(studentFee.feeCategoryId);
      if (category && category.name.toLowerCase().includes('full')) {
        await StudentFee.updateMany(
          {
            studentId,
            _id: { $ne: studentFeeId },
            remainingAmount: { $gt: 0 }
          },
          { remainingAmount: 0 }
        );
      }
    }

    await ActivityLog.create({
      userId: req.user.id,
      action: 'CREATED_PAYMENT',
      details: `Payment of ${amount} recorded for student ${studentId}`
    });

    res.status(201).json({ ...payment.toObject(), invoice });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error creating payment' });
  }
};

export const getPaymentHistory = async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate('studentId', 'studentName admissionNumber')
      .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId' } })
      .populate('recordedById', 'username')
      .sort({ paymentDate: -1 });

    const paymentIds = payments.map(p => p._id);
    const invoices = await Invoice.find({ paymentId: { $in: paymentIds } });
    const invoiceMap = {};
    invoices.forEach(inv => {
      invoiceMap[inv.paymentId.toString()] = inv;
    });

    const paymentsWithInvoices = payments.map(p => {
      const pObj = p.toObject();
      pObj.invoice = invoiceMap[p._id.toString()] || null;
      if (pObj.studentId) {
        pObj.student = pObj.studentId;
      }
      if (pObj.studentFeeId) {
        pObj.studentFee = pObj.studentFeeId;
        if (pObj.studentFee.feeCategoryId) {
          pObj.studentFee.feeCategory = pObj.studentFee.feeCategoryId;
        }
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

    const payment = await Payment.findById(id)
      .populate('studentId')
      .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId' } })
      .populate('recordedById', 'username');

    const invoice = await Invoice.findOne({ paymentId: id });

    if (!payment || !invoice) {
      res.status(404).json({ error: 'Payment or invoice not found' });
      return;
    }

    const doc = new PDFDocument({ margin: 30, size: 'A5', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice_${invoice.invoiceNumber}.pdf`);

    doc.pipe(res);

    doc.rect(0, 0, doc.page.width, 10).fill('#1E3A8A');

    const logoPath = path.resolve(process.cwd(), '../frontend/public/logo.svg');
    if (fs.existsSync(logoPath)) {
      try {
        const svgCode = fs.readFileSync(logoPath, 'utf8');
        doc.save();
        doc.translate(40, 15);
        doc.scale(60 / 400);
        SVGtoPDF(doc, svgCode, 0, 0, { assumePt: true });
        doc.restore();
      } catch(e) {
        console.error("Error loading SVG logo:", e);
      }
    }

    doc.fillColor('#1E3A8A')
       .fontSize(18)
       .font('Helvetica-Bold')
       .text('KASTHURI NURSERY & PRIMARY SCHOOL', 110, 25, { align: 'left' });

    doc.fillColor('#4B5563')
       .fontSize(9)
       .font('Helvetica')
       .text('No.15 & 44 Eda Street, Saidapet, Vellore - 632 012.', 110, 48)
       .text('Phone: 0416-2211877, +91 97919 50179 | Email: Kasthurinurseryschool@gmail.com', 110, 60);

    doc.fillColor('#000000')
       .fontSize(14)
       .font('Helvetica-Bold')
       .text('FEE RECEIPT / INVOICE', 40, 85, { align: 'right' });

    doc.moveTo(40, 105).lineTo(555, 105).strokeColor('#E5E7EB').stroke();

    const topY = 120;

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151').text('Invoice Details:', 40, topY);
    doc.font('Helvetica').fillColor('#000000').text(`Invoice No: ${invoice.invoiceNumber}`, 40, topY + 15);
    doc.text(`Date: ${payment.paymentDate.toLocaleDateString()}`, 40, topY + 30);
    doc.text(`Payment Method: ${payment.paymentMethod}`, 40, topY + 45);
    let currentY = topY + 60;
    if (payment.referenceNumber) {
      doc.text(`Ref No: ${payment.referenceNumber}`, 40, currentY);
      currentY += 15;
    }
    if (payment.recordedById) {
      doc.text(`Recorded By: ${payment.recordedById.username}`, 40, currentY);
    }

    doc.font('Helvetica-Bold').fillColor('#374151').text('Student Details:', 300, topY);
    doc.font('Helvetica').fillColor('#000000').text(`Name: ${payment.studentId.studentName}`, 300, topY + 15);
    doc.text(`Admission No: ${payment.studentId.admissionNumber}`, 300, topY + 30);
    doc.text(`Class & Section: ${payment.studentId.currentClass} ${payment.studentId.section || ''}`, 300, topY + 45);
    doc.text(`Parents: ${payment.studentId.fatherName} / ${payment.studentId.motherName}`, 300, topY + 60);

    const tableTop = 215;
    doc.rect(40, tableTop, 515, 20).fill('#F3F4F6');
    doc.fillColor('#374151').font('Helvetica-Bold');
    doc.text('Fee Description', 50, tableTop + 6);
    doc.text('Total Amount', 240, tableTop + 6);
    doc.text('Paid (This Receipt)', 340, tableTop + 6);
    doc.text('Balance', 460, tableTop + 6);

    const rowTop = tableTop + 20;
    doc.moveTo(40, rowTop).lineTo(555, rowTop).strokeColor('#E5E7EB').stroke();

    doc.fillColor('#000000').font('Helvetica');
    if (payment.isFullPayment) {
      doc.text('Consolidated Full Fees', 50, rowTop + 8);
      doc.text(`Rs. ${payment.amount.toFixed(2)}`, 240, rowTop + 8);
      doc.text(`Rs. ${payment.amount.toFixed(2)}`, 340, rowTop + 8);
      doc.text(`Rs. 0.00`, 460, rowTop + 8);
    } else if (payment.studentFeeId) {
      doc.text(payment.studentFeeId.feeCategoryId?.name || 'Fee', 50, rowTop + 8);
      doc.text(`Rs. ${payment.studentFeeId.totalAmount.toFixed(2)}`, 240, rowTop + 8);
      doc.text(`Rs. ${payment.amount.toFixed(2)}`, 340, rowTop + 8);
      doc.text(`Rs. ${payment.studentFeeId.remainingAmount.toFixed(2)}`, 460, rowTop + 8);
    }

    doc.moveTo(40, rowTop + 25).lineTo(555, rowTop + 25).strokeColor('#E5E7EB').stroke();

    const summaryTop = rowTop + 40;
    doc.font('Helvetica-Bold').fillColor('#374151').text('Payment Summary', 340, summaryTop);
    doc.moveTo(340, summaryTop + 15).lineTo(555, summaryTop + 15).strokeColor('#E5E7EB').stroke();

    doc.font('Helvetica').fillColor('#000000').text('Amount Received:', 340, summaryTop + 25);
    doc.font('Helvetica-Bold').text(`Rs. ${payment.amount.toFixed(2)}`, 460, summaryTop + 25);

    doc.font('Helvetica').text('Remaining Balance:', 340, summaryTop + 45);
    if (payment.isFullPayment) {
      doc.font('Helvetica').text(`Rs. 0.00`, 460, summaryTop + 45);
    } else if (payment.studentFeeId) {
      doc.font('Helvetica').text(`Rs. ${payment.studentFeeId.remainingAmount.toFixed(2)}`, 460, summaryTop + 45);
    }

    const signatureTop = summaryTop + 60;
    doc.moveTo(40, signatureTop).lineTo(160, signatureTop).strokeColor('#000000').stroke();
    doc.font('Helvetica').text('Authorized Signature', 40, signatureTop + 10, { align: 'center', width: 120 });

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151').text('Thank you for your payment. For any queries, please contact the school administration.', 40, 375, { align: 'center' });

    doc.end();

  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error generating PDF' });
    }
  }
};

export const deletePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await Payment.findById(id);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.isFullPayment && payment.feeAllocations && payment.feeAllocations.length > 0) {
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

    await Invoice.deleteMany({ paymentId: id });
    await Payment.findByIdAndDelete(id);

    res.json({ message: 'Payment deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error deleting payment' });
  }
};
