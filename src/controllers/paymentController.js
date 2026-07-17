import mongoose from 'mongoose';
import { Student, StudentFee, Payment, Invoice, FeeCategory, ActivityLog, StockHistory } from '../models/index.js';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

const generateInvoiceNumber = async () => {
  const currentYear = new Date().getFullYear();
  // Find the invoice with the highest number for the current year
  const lastInvoice = await Invoice.findOne({ invoiceNumber: new RegExp(`^INV-${currentYear}-`) })
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

const getInvoicePaymentData = async (id) => {
  const paymentDoc = await Payment.findById(id)
    .populate('studentId')
    .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId' } })
    .populate({ path: 'feeAllocations.studentFeeId', populate: { path: 'feeCategoryId' } })
    .populate('recordedById', 'username');

  const invoiceDoc = await Invoice.findOne({ paymentId: id });

  if (!paymentDoc || !invoiceDoc) {
    return null;
  }

  const payment = paymentDoc.toObject();
  const invoice = invoiceDoc.toObject();

  payment.invoice = invoice;

  if (payment.studentId) {
    payment.student = payment.studentId;
  }

  if (payment.studentFeeId) {
    payment.studentFee = payment.studentFeeId;
    if (payment.studentFee.feeCategoryId) {
      payment.studentFee.feeCategory = payment.studentFee.feeCategoryId;
    }
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
    const allFees = await StudentFee.find({ studentId });
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
    const { studentId, studentFeeIds, amount, paymentMethod, referenceNumber, remarks } = req.body;

    if (!studentFeeIds || !Array.isArray(studentFeeIds) || studentFeeIds.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'No fees selected for payment' });
    }

    // Self-heal any zero-amount StudentFee documents in MongoDB before balance validation
    for (const feeId of studentFeeIds) {
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

    const unpaidFees = await StudentFee.find({ _id: { $in: studentFeeIds }, studentId }).session(session);
    if (unpaidFees.length !== studentFeeIds.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Some fee records were not found or do not belong to this student' });
    }

    const totalRemaining = unpaidFees.reduce((sum, f) => sum + f.remainingAmount, 0);
    if (amount > totalRemaining) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        error: `Payment amount (Rs. ${amount}) cannot exceed the total remaining balance (Rs. ${totalRemaining}) for the selected fees.`
      });
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
      }, { session });
      
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

    // Pre-validate stock availability for any stock items in payment
    for (const alloc of feeAllocations) {
      const studentFee = unpaidFees.find(f => f._id.toString() === alloc.studentFeeId.toString());
      if (studentFee && studentFee.feeCategoryId) {
        const cat = await FeeCategory.findById(studentFee.feeCategoryId).session(session);
        if (cat && cat.isStockItem) {
          if ((cat.currentStock || 0) <= 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ error: `Insufficient stock for ${cat.name}. Current stock is 0.` });
          }
        }
      }
    }

    const [payment] = await Payment.create([{
      studentId,
      isFullPayment: false, 
      feeAllocations,
      amount,
      paymentMethod,
      referenceNumber,
      remarks,
      status: amount === totalRemaining ? 'PAID' : 'PARTIAL',
      inventoryProcessed: false,
      recordedById: req.user.id
    }], { session });
    
    // Deduct stock atomically and set inventoryProcessed flag
    for (const alloc of feeAllocations) {
      const studentFee = unpaidFees.find(f => f._id.toString() === alloc.studentFeeId.toString());
      if (studentFee && studentFee.feeCategoryId) {
        const cat = await FeeCategory.findById(studentFee.feeCategoryId).session(session);
        if (cat && cat.isStockItem) {
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
            updatedBy: req.user.id
          }], { session });

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
      userId: req.user.id,
      action: 'CREATED_PAYMENT',
      details: `Payment of ${amount} recorded for student ${studentId} covering multiple fees`
    }], { session });
    
    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ ...payment.toObject(), invoice });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error(error);
    res.status(500).json({ error: error.message || 'Error creating payment' });
  }
};

export const getPaymentHistory = async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate('studentId', 'studentName admissionNumber currentClass section')
      .populate('applicationId', 'studentName applicationId applyingClass')
      .populate({ path: 'studentFeeId', populate: { path: 'feeCategoryId' } })
      .populate({ path: 'feeAllocations.studentFeeId', populate: { path: 'feeCategoryId' } })
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
      if (pObj.applicationId) {
        pObj.application = pObj.applicationId;
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

    const invoiceContext = await getInvoicePaymentData(id);

    if (!invoiceContext) {
      res.status(404).json({ error: 'Payment or invoice not found' });
      return;
    }

    const { payment, invoice, summary } = invoiceContext;
    const { fullRemainingBalance } = summary;


    const doc = new PDFDocument({ 
      margins: { top: 10, bottom: 5, left: 40, right: 40 }, 
      size: [595.28, 280.63] 
    });

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
        doc.scale(50 / 400);
        SVGtoPDF(doc, svgCode, 0, 0, { assumePt: true });
        doc.restore();
      } catch(e) {
        console.error("Error loading SVG logo:", e);
      }
    }

    doc.fillColor('#1E3A8A')
       .fontSize(14)
       .font('Helvetica-Bold')
       .text('KASTHURI NURSERY & PRIMARY SCHOOL', 95, 20, { align: 'left' });

    doc.fillColor('#4B5563')
       .fontSize(8)
       .font('Helvetica')
       .text('No.15 & 44 Eda Street, Saidapet, Vellore - 632 012.', 95, 35)
       .text('Phone: 0416-2211877, +91 97919 50179 | Email: Kasthurinurseryschool@gmail.com', 95, 45);

    doc.fillColor('#000000')
       .fontSize(12)
       .font('Helvetica-Bold')
       .text('FEE RECEIPT / INVOICE', 40, 20, { align: 'right' });

    doc.moveTo(40, 65).lineTo(555, 65).strokeColor('#E5E7EB').stroke();

    const topY = 75;

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151').text('Invoice Details:', 40, topY);
    doc.font('Helvetica').fillColor('#000000').text(`Date: ${payment.paymentDate.toLocaleDateString()}`, 40, topY + 12);
    doc.text(`Payment Method: ${payment.paymentMethod}`, 40, topY + 24);
    if (payment.referenceNumber) {
      doc.text(`Ref No: ${payment.referenceNumber}`, 40, topY + 36);
    }

    doc.font('Helvetica-Bold').fillColor('#374151').text('Student Details:', 300, topY);
    doc.font('Helvetica').fillColor('#000000').text(`Name: ${payment.studentId.studentName}`, 300, topY + 12);
    doc.text(`Admission No: ${payment.studentId.admissionNumber}`, 300, topY + 24);
    doc.text(`Class & Section: ${payment.studentId.currentClass} ${payment.studentId.section || ''}`, 300, topY + 36);

    const tableTop = 125;
    doc.rect(40, tableTop, 515, 18).fill('#F3F4F6');
    doc.fillColor('#374151').font('Helvetica-Bold');
    doc.text('Fee Description', 50, tableTop + 5);
    doc.text('Total Amount', 240, tableTop + 5);
    doc.text('Paid (This Receipt)', 340, tableTop + 5);
    doc.text('Balance', 460, tableTop + 5);

    let currentRowTop = tableTop + 18;

    doc.fillColor('#000000').font('Helvetica');
    if (payment.feeAllocations && payment.feeAllocations.length > 0) {
      payment.feeAllocations.forEach((alloc) => {
        doc.moveTo(40, currentRowTop).lineTo(555, currentRowTop).strokeColor('#E5E7EB').stroke();
        const fee = alloc.studentFeeId;
        const feeName = fee?.feeCategoryId?.name || 'Fee';
        
        doc.text(feeName, 50, currentRowTop + 6);
        doc.text(`Rs. ${fee?.totalAmount?.toFixed(2) || '0.00'}`, 240, currentRowTop + 6);
        doc.text(`Rs. ${alloc.amount.toFixed(2)}`, 340, currentRowTop + 6);
        doc.text(`Rs. ${fee?.remainingAmount?.toFixed(2) || '0.00'}`, 460, currentRowTop + 6);
        
        currentRowTop += 20;
      });
    } else if (payment.studentFeeId) {
      doc.moveTo(40, currentRowTop).lineTo(555, currentRowTop).strokeColor('#E5E7EB').stroke();
      doc.text(payment.studentFeeId.feeCategoryId?.name || 'Fee', 50, currentRowTop + 6);
      doc.text(`Rs. ${payment.studentFeeId.totalAmount.toFixed(2)}`, 240, currentRowTop + 6);
      doc.text(`Rs. ${payment.amount.toFixed(2)}`, 340, currentRowTop + 6);
      doc.text(`Rs. ${payment.studentFeeId.remainingAmount.toFixed(2)}`, 460, currentRowTop + 6);
      currentRowTop += 20;
    }

    doc.moveTo(40, currentRowTop).lineTo(555, currentRowTop).strokeColor('#E5E7EB').stroke();

    const summaryTop = currentRowTop + 10;
    doc.font('Helvetica-Bold').fillColor('#374151').text('Payment Summary', 340, summaryTop);
    doc.moveTo(340, summaryTop + 12).lineTo(555, summaryTop + 12).strokeColor('#E5E7EB').stroke();

    doc.font('Helvetica').fillColor('#000000').text('Amount Received:', 340, summaryTop + 18);
    doc.font('Helvetica-Bold').text(`Rs. ${payment.amount.toFixed(2)}`, 460, summaryTop + 18);

    doc.font('Helvetica').text('Remaining Balance:', 340, summaryTop + 32);
    if (payment.feeAllocations && payment.feeAllocations.length > 0) {
      doc.font('Helvetica').text(`Rs. ${fullRemainingBalance.toFixed(2)}`, 460, summaryTop + 32);
    } else if (payment.studentFeeId) {
      doc.font('Helvetica').text(`Rs. ${payment.studentFeeId.remainingAmount.toFixed(2)}`, 460, summaryTop + 32);
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
                updatedBy: req.user?.id
              });

              await StudentFee.findByIdAndUpdate(studentFee._id, {
                isStockDeducted: false
              });
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
