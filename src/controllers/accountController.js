import mongoose from 'mongoose';
import { Expense, Payment, Application } from '../models/index.js';

const parseDateString = (dateStr) => {
  if (!dateStr) return null;
  const parts = String(dateStr).trim().split('-');
  if (parts.length === 3) {
    const [y, m, d] = parts.map(Number);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return { y, m: m - 1, d };
    }
  }
  const dateObj = new Date(dateStr);
  if (isNaN(dateObj.getTime())) return null;
  return { y: dateObj.getFullYear(), m: dateObj.getMonth(), d: dateObj.getDate() };
};

const getStartOfDay = (dateInfo) => {
  const utc = new Date(Date.UTC(dateInfo.y, dateInfo.m, dateInfo.d, 0, 0, 0, 0));
  const local = new Date(dateInfo.y, dateInfo.m, dateInfo.d, 0, 0, 0, 0);
  return new Date(Math.min(utc.getTime(), local.getTime()));
};

const getEndOfDay = (dateInfo) => {
  const utc = new Date(Date.UTC(dateInfo.y, dateInfo.m, dateInfo.d, 23, 59, 59, 999));
  const local = new Date(dateInfo.y, dateInfo.m, dateInfo.d, 23, 59, 59, 999);
  return new Date(Math.max(utc.getTime(), local.getTime()));
};

export const getAccounts = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Fetch Total Collections dynamically matching the exact Reports logic (Payments + Application fees)
    // and Total Expenses across all saved expenses
    const [paymentTotals, applicationTotals, totalExpensesAgg] = await Promise.all([
      Payment.aggregate([
        { $match: { paymentType: { $ne: 'APPLICATION' } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Application.aggregate([
        { $match: { feePaid: true } },
        { $group: { _id: null, total: { $sum: '$feeAmount' } } }
      ]),
      Expense.aggregate([
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    const paymentTotal = paymentTotals[0]?.total || 0;
    const appFeeTotal = applicationTotals[0]?.total || 0;
    const totalAmount = Math.round((paymentTotal + appFeeTotal) * 100) / 100;
    const totalExpenses = totalExpensesAgg.length > 0 ? Math.round(totalExpensesAgg[0].total * 100) / 100 : 0;
    const balance = Math.round((totalAmount - totalExpenses) * 100) / 100;

    // Build filter query for expenses list
    const query = {};

    if (startDate || endDate) {
      if (startDate && endDate) {
        const startInfo = parseDateString(startDate);
        const endInfo = parseDateString(endDate);
        if (!startInfo || !endInfo) {
          return res.status(400).json({ error: 'Invalid date format' });
        }
        const startObj = getStartOfDay(startInfo);
        const endObj = getEndOfDay(endInfo);
        if (startObj > endObj) {
          return res.status(400).json({ error: 'Start date cannot be after end date' });
        }
        query.date = { $gte: startObj, $lte: endObj };
      } else if (startDate && !endDate) {
        // If only start date is given, show data on that specific date only
        const dateInfo = parseDateString(startDate);
        if (!dateInfo) {
          return res.status(400).json({ error: 'Invalid start date format' });
        }
        query.date = { $gte: getStartOfDay(dateInfo), $lte: getEndOfDay(dateInfo) };
      } else if (!startDate && endDate) {
        // If only end date is given, show data on that specific date only
        const dateInfo = parseDateString(endDate);
        if (!dateInfo) {
          return res.status(400).json({ error: 'Invalid end date format' });
        }
        query.date = { $gte: getStartOfDay(dateInfo), $lte: getEndOfDay(dateInfo) };
      }
    }

    const expenses = await Expense.find(query)
      .sort({ date: -1, createdAt: -1 })
      .lean();

    const filteredTotal = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const roundedFilteredTotal = Math.round(filteredTotal * 100) / 100;

    res.json({
      totalAmount,
      totalExpenses,
      balance,
      expenses,
      filteredTotal: roundedFilteredTotal,
      totalCount: expenses.length,
      hasFilters: Boolean(startDate || endDate)
    });
  } catch (error) {
    console.error('Error in getAccounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts data' });
  }
};

export const updateTotalAmount = async (req, res) => {
  return res.status(400).json({
    error: 'Total amount is calculated dynamically from Total Collections and cannot be set manually.'
  });
};

export const createExpense = async (req, res) => {
  try {
    const { date, notes, amount } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'Expense date is required' });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid expense date' });
    }

    const trimmedNotes = String(notes || '').trim();
    if (!trimmedNotes) {
      return res.status(400).json({ error: 'Notes or description is required' });
    }

    if (amount === undefined || amount === null || amount === '') {
      return res.status(400).json({ error: 'Amount is required' });
    }

    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || !Number.isFinite(parsedAmount)) {
      return res.status(400).json({ error: 'Amount must be a valid number' });
    }

    if (parsedAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than zero' });
    }

    const roundedAmount = Math.round(parsedAmount * 100) / 100;

    // Use noon UTC for consistent storage without timezone boundary shifting
    const dateInfo = parseDateString(date);
    const storedDate = dateInfo
      ? new Date(Date.UTC(dateInfo.y, dateInfo.m, dateInfo.d, 12, 0, 0))
      : parsedDate;

    const expense = await Expense.create({
      date: storedDate,
      notes: trimmedNotes,
      amount: roundedAmount,
      createdBy: req.user?.id
    });

    res.status(201).json({
      message: 'Expense added successfully',
      expense
    });
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: 'Failed to add expense' });
  }
};

export const deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid expense ID' });
    }

    const deleted = await Expense.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
};
