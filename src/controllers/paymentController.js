import prisma from '../utils/prisma.js';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

const generateInvoiceNumber = async () => {
  const count = await prisma.invoice.count();
  return `INV-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;
};

export const createPayment = async (req, res) => {
  try {
    const { studentId, studentFeeId, amount, paymentMethod, referenceNumber, remarks } = req.body;

    const studentFee = await prisma.studentFee.findUnique({ where: { id: studentFeeId } });
    
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

    const payment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          studentId,
          studentFeeId,
          amount,
          paymentMethod,
          referenceNumber,
          remarks,
          status: feeStatus,
          recordedById: req.user.id
        }
      });

      await tx.studentFee.update({
        where: { id: studentFeeId },
        data: {
          paidAmount: newPaidAmount,
          remainingAmount: newRemainingAmount
        }
      });

      const invoiceNumber = await generateInvoiceNumber();
      
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          paymentId: p.id,
          studentId: studentId
        }
      });

      // Logic: If 'Full fees' is paid, clear all other pending fees for this student
      if (feeStatus === 'PAID') {
        const category = await tx.feeCategory.findUnique({ where: { id: studentFee.feeCategoryId } });
        if (category && category.name.toLowerCase().includes('full')) {
          await tx.studentFee.updateMany({
            where: {
              studentId: studentId,
              id: { not: studentFeeId },
              remainingAmount: { gt: 0 }
            },
            data: {
              remainingAmount: 0
            }
          });
        }
      }

      return { ...p, invoice };
    });

    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATED_PAYMENT',
        details: `Payment of ${amount} recorded for student ${studentId}`
      }
    });

    res.status(201).json(payment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error creating payment' });
  }
};

export const getPaymentHistory = async (req, res) => {
  try {
    const payments = await prisma.payment.findMany({
      include: {
        student: { select: { studentName: true, admissionNumber: true } },
        studentFee: { include: { feeCategory: true } },
        invoice: true,
        recordedBy: { select: { username: true } }
      },
      orderBy: { paymentDate: 'desc' }
    });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching payments' });
  }
};

import SVGtoPDF from 'svg-to-pdfkit';

export const generateInvoicePDF = async (req, res) => {
  try {
    const { id } = req.params; // payment ID

    const payment = await prisma.payment.findUnique({
      where: { id: id  },
      include: {
        student: true,
        studentFee: { include: { feeCategory: true } },
        invoice: true,
        recordedBy: { select: { username: true } }
      }
    });

    if (!payment || !payment.invoice) {
      res.status(404).json({ error: 'Payment or invoice not found' });
      return;
    }

    const doc = new PDFDocument({ margin: 30, size: 'A5', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice_${payment.invoice.invoiceNumber}.pdf`);

    doc.pipe(res);

    // Header Background Accent Line
    doc.rect(0, 0, doc.page.width, 10).fill('#1E3A8A');

    // Attempt to add SVG logo
    const logoPath = path.resolve(process.cwd(), '../frontend/public/logo.svg');
    if (fs.existsSync(logoPath)) {
      try {
        const svgCode = fs.readFileSync(logoPath, 'utf8');
        doc.save();
        doc.translate(40, 15);
        doc.scale(60 / 400); // Scale down 400x400 SVG to 60x60
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

    // Invoice Title
    doc.fillColor('#000000')
       .fontSize(14)
       .font('Helvetica-Bold')
       .text('FEE RECEIPT / INVOICE', 40, 85, { align: 'right' });

    doc.moveTo(40, 105).lineTo(555, 105).strokeColor('#E5E7EB').stroke();

    // Two columns for Invoice Info and Student Info
    const topY = 120;
    
    // Left col: Invoice Details
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151').text('Invoice Details:', 40, topY);
    doc.font('Helvetica').fillColor('#000000').text(`Invoice No: ${payment.invoice.invoiceNumber}`, 40, topY + 15);
    doc.text(`Date: ${payment.paymentDate.toLocaleDateString()}`, 40, topY + 30);
    doc.text(`Payment Method: ${payment.paymentMethod}`, 40, topY + 45);
    let currentY = topY + 60;
    if (payment.referenceNumber) {
      doc.text(`Ref No: ${payment.referenceNumber}`, 40, currentY);
      currentY += 15;
    }
    if (payment.recordedBy) {
      doc.text(`Recorded By: ${payment.recordedBy.username}`, 40, currentY);
    }

    // Right col: Student Details
    doc.font('Helvetica-Bold').fillColor('#374151').text('Student Details:', 300, topY);
    doc.font('Helvetica').fillColor('#000000').text(`Name: ${payment.student.studentName}`, 300, topY + 15);
    doc.text(`Admission No: ${payment.student.admissionNumber}`, 300, topY + 30);
    doc.text(`Class & Section: ${payment.student.currentClass} ${payment.student.section || ''}`, 300, topY + 45);
    doc.text(`Parents: ${payment.student.fatherName} / ${payment.student.motherName}`, 300, topY + 60);

    // Table Header
    const tableTop = 215;
    doc.rect(40, tableTop, 515, 20).fill('#F3F4F6');
    doc.fillColor('#374151').font('Helvetica-Bold');
    doc.text('Fee Description', 50, tableTop + 6);
    doc.text('Total Amount', 240, tableTop + 6);
    doc.text('Paid (This Receipt)', 340, tableTop + 6);
    doc.text('Balance', 460, tableTop + 6);

    // Table Row
    const rowTop = tableTop + 20;
    doc.moveTo(40, rowTop).lineTo(555, rowTop).strokeColor('#E5E7EB').stroke();
    
    doc.fillColor('#000000').font('Helvetica');
    doc.text(payment.studentFee.feeCategory.name, 50, rowTop + 8);
    doc.text(`Rs. ${payment.studentFee.totalAmount.toFixed(2)}`, 240, rowTop + 8);
    doc.text(`Rs. ${payment.amount.toFixed(2)}`, 340, rowTop + 8);
    doc.text(`Rs. ${payment.studentFee.remainingAmount.toFixed(2)}`, 460, rowTop + 8);

    doc.moveTo(40, rowTop + 25).lineTo(555, rowTop + 25).strokeColor('#E5E7EB').stroke();

    // Summary Section
    const summaryTop = rowTop + 40;
    doc.font('Helvetica-Bold').fillColor('#374151').text('Payment Summary', 340, summaryTop);
    doc.moveTo(340, summaryTop + 15).lineTo(555, summaryTop + 15).strokeColor('#E5E7EB').stroke();
    
    doc.font('Helvetica').fillColor('#000000').text('Amount Received:', 340, summaryTop + 25);
    doc.font('Helvetica-Bold').text(`Rs. ${payment.amount.toFixed(2)}`, 460, summaryTop + 25);
    
    doc.font('Helvetica').text('Remaining Balance:', 340, summaryTop + 45);
    doc.font('Helvetica').text(`Rs. ${payment.studentFee.remainingAmount.toFixed(2)}`, 460, summaryTop + 45);

    // Footer
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
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    await prisma.studentFee.update({
      where: { id: payment.studentFeeId },
      data: {
        paidAmount: { decrement: payment.amount },
        remainingAmount: { increment: payment.amount }
      }
    });

    await prisma.invoice.deleteMany({ where: { paymentId: id } });
    await prisma.payment.delete({ where: { id } });

    res.json({ message: 'Payment deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error deleting payment' });
  }
};
