import { IncludedCharge, StudentIncludedCharge } from '../models/index.js';

export const getIncludedCharges = async (req, res) => {
  try {
    const charges = await IncludedCharge.find()
      .populate('createdById', 'username')
      .sort({ createdAt: -1 });
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
    const { name, description, amount, status } = req.body;
    
    const existing = await IncludedCharge.findOne({ name });
    if (existing) {
      return res.status(400).json({ error: 'Included charge with this name already exists' });
    }

    const charge = await IncludedCharge.create({
      name,
      description,
      amount: parseFloat(amount),
      status,
      createdById: req.user.id
    });
    res.status(201).json(charge);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create included charge' });
  }
};

export const updateIncludedCharge = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, amount, status } = req.body;
    
    if (name) {
      const existing = await IncludedCharge.findOne({ name });
      if (existing && existing.id !== id) {
        return res.status(400).json({ error: 'Another included charge with this name already exists' });
      }
    }

    const dataToUpdate = {};
    if (name !== undefined) dataToUpdate.name = name;
    if (description !== undefined) dataToUpdate.description = description;
    if (amount !== undefined) dataToUpdate.amount = parseFloat(amount);
    if (status !== undefined) dataToUpdate.status = status;

    const charge = await IncludedCharge.findByIdAndUpdate(id, dataToUpdate, { new: true });
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

    await IncludedCharge.findByIdAndDelete(id);
    res.json({ message: 'Included charge deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete included charge' });
  }
};
