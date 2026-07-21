import { IncludedCharge, StudentIncludedCharge, IncludedChargeStockTransaction } from '../models/index.js';

const clampNonNegative = (value) => Math.max(0, Number(value) || 0);

const recordStockTransaction = async ({
  includedChargeId,
  type,
  quantity,
  previousStock,
  newStock,
  reason,
  referenceType,
  referenceId,
  performedById
}) => {
  await IncludedChargeStockTransaction.create({
    includedChargeId,
    type,
    quantity,
    previousStock,
    newStock,
    reason,
    referenceType,
    referenceId,
    performedById
  });
};

export const getIncludedCharges = async (req, res) => {
  try {
    const charges = await IncludedCharge.find()
      .populate('createdById', 'username')
      .select('name description amount stockQuantity lowStockThreshold stockUnit status createdById createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean();
    res.json(charges);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch included charges' });
  }
};

export const getIncludedChargeById = async (req, res) => {
  try {
    const charge = await IncludedCharge.findById(req.params.id);
    if (!charge) return res.status(404).json({ error: 'Not found' });
    res.json(charge);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch included charge' });
  }
};

export const createIncludedCharge = async (req, res) => {
  try {
    const { name, description, amount, status, stockQuantity, lowStockThreshold, stockUnit } = req.body;
    
    const existing = await IncludedCharge.findOne({ name });
    if (existing) {
      return res.status(400).json({ error: 'Included charge with this name already exists' });
    }

    const charge = await IncludedCharge.create({
      name,
      description,
      amount: parseFloat(amount),
      stockQuantity: clampNonNegative(stockQuantity),
      lowStockThreshold: clampNonNegative(lowStockThreshold ?? 5),
      stockUnit: stockUnit || 'pcs',
      status,
      createdById: req.user.id
    });

    if (clampNonNegative(stockQuantity) > 0) {
      await recordStockTransaction({
        includedChargeId: charge._id,
        type: 'IN',
        quantity: clampNonNegative(stockQuantity),
        previousStock: 0,
        newStock: clampNonNegative(stockQuantity),
        reason: 'Initial stock on item creation',
        performedById: req.user.id
      });
    }

    res.status(201).json(charge);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create included charge' });
  }
};

export const updateIncludedCharge = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, amount, status, stockQuantity, lowStockThreshold, stockUnit } = req.body;
    
    if (name) {
      const existing = await IncludedCharge.findOne({ name });
      if (existing && existing.id !== id) {
        return res.status(400).json({ error: 'Another included charge with this name already exists' });
      }
    }

    const existingCharge = await IncludedCharge.findById(id);
    const dataToUpdate = {};
    if (name !== undefined) dataToUpdate.name = name;
    if (description !== undefined) dataToUpdate.description = description;
    if (amount !== undefined) dataToUpdate.amount = parseFloat(amount);
    if (status !== undefined) dataToUpdate.status = status;
    if (stockQuantity !== undefined) dataToUpdate.stockQuantity = clampNonNegative(stockQuantity);
    if (lowStockThreshold !== undefined) dataToUpdate.lowStockThreshold = clampNonNegative(lowStockThreshold);
    if (stockUnit !== undefined) dataToUpdate.stockUnit = stockUnit || 'pcs';

    const charge = await IncludedCharge.findByIdAndUpdate(id, dataToUpdate, { new: true });

    if (existingCharge && stockQuantity !== undefined) {
      const prevStock = clampNonNegative(existingCharge.stockQuantity);
      const nextStock = clampNonNegative(stockQuantity);
      const delta = nextStock - prevStock;
      if (delta !== 0) {
        await recordStockTransaction({
          includedChargeId: charge._id,
          type: delta > 0 ? 'IN' : 'OUT',
          quantity: Math.abs(delta),
          previousStock: prevStock,
          newStock: nextStock,
          reason: 'Stock changed during included charge update',
          performedById: req.user?.id
        });
      }
    }

    res.json(charge);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update included charge' });
  }
};

export const deleteIncludedCharge = async (req, res) => {
  try {
    const { id } = req.params;
    
    const mappings = await StudentIncludedCharge.findOne({ includedChargeId: id });

    if (mappings) {
      return res.status(400).json({ error: 'This Included Charge is already assigned to students and cannot be deleted.' });
    }

    const charge = await IncludedCharge.findById(id);
    if (!charge) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (clampNonNegative(charge.stockQuantity) > 0) {
      return res.status(400).json({ error: 'Cannot delete an included charge with remaining stock. Reduce stock to zero first.' });
    }

    await IncludedCharge.findByIdAndDelete(id);
    res.json({ message: 'Included charge deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete included charge' });
  }
};

export const getIncludedChargeStockTransactions = async (req, res) => {
  try {
    const { id } = req.params;
    const transactions = await IncludedChargeStockTransaction.find({ includedChargeId: id })
      .populate('performedById', 'username')
      .select('includedChargeId type quantity previousStock newStock reason referenceType referenceId performedById createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean();
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stock transactions' });
  }
};

export const adjustIncludedChargeStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { type = 'ADJUSTMENT', quantity, reason } = req.body;

    const qty = Math.abs(parseInt(quantity, 10));
    if (!qty || qty <= 0) {
      return res.status(400).json({ error: 'Quantity must be greater than zero' });
    }

    const charge = await IncludedCharge.findById(id);
    if (!charge) {
      return res.status(404).json({ error: 'Included charge not found' });
    }

    const prevStock = clampNonNegative(charge.stockQuantity);
    let nextStock = prevStock;

    if (type === 'IN' || type === 'RETURN' || type === 'ADJUSTMENT') {
      nextStock = prevStock + qty;
    } else if (type === 'OUT') {
      if (prevStock < qty) {
        return res.status(400).json({ error: 'Not enough stock available' });
      }
      nextStock = prevStock - qty;
    } else {
      return res.status(400).json({ error: 'Invalid stock transaction type' });
    }

    charge.stockQuantity = nextStock;
    await charge.save();

    await recordStockTransaction({
      includedChargeId: charge._id,
      type,
      quantity: qty,
      previousStock: prevStock,
      newStock: nextStock,
      reason,
      performedById: req.user?.id
    });

    res.json(charge);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to adjust stock' });
  }
};
