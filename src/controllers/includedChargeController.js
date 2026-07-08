import prisma from '../utils/prisma.js';

export const getIncludedCharges = async (req, res) => {
  try {
    const charges = await prisma.includedCharge.findMany({
      include: {
        createdBy: {
          select: { username: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(charges);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch included charges' });
  }
};

export const getIncludedChargeById = async (req, res) => {
  try {
    const charge = await prisma.includedCharge.findUnique({
      where: { id: req.params.id }
    });
    if (!charge) return res.status(404).json({ error: 'Not found' });
    res.json(charge);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch included charge' });
  }
};

export const createIncludedCharge = async (req, res) => {
  try {
    const { name, description, amount, status } = req.body;
    
    const existing = await prisma.includedCharge.findUnique({ where: { name } });
    if (existing) {
      return res.status(400).json({ error: 'Included charge with this name already exists' });
    }

    const charge = await prisma.includedCharge.create({
      data: {
        name,
        description,
        amount: parseFloat(amount),
        status,
        createdById: req.user.id
      }
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
    
    // Check name uniqueness if name is changed
    if (name) {
      const existing = await prisma.includedCharge.findUnique({ where: { name } });
      if (existing && existing.id !== id) {
        return res.status(400).json({ error: 'Another included charge with this name already exists' });
      }
    }

    const dataToUpdate = {};
    if (name !== undefined) dataToUpdate.name = name;
    if (description !== undefined) dataToUpdate.description = description;
    if (amount !== undefined) dataToUpdate.amount = parseFloat(amount);
    if (status !== undefined) dataToUpdate.status = status;

    const charge = await prisma.includedCharge.update({
      where: { id },
      data: dataToUpdate
    });
    res.json(charge);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update included charge' });
  }
};

export const deleteIncludedCharge = async (req, res) => {
  try {
    const { id } = req.params;
    
    const mappings = await prisma.studentIncludedCharge.findFirst({
      where: { includedChargeId: id }
    });

    if (mappings) {
      return res.status(400).json({ error: 'This Included Charge is already assigned to students and cannot be deleted.' });
    }

    await prisma.includedCharge.delete({
      where: { id }
    });
    res.json({ message: 'Included charge deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete included charge' });
  }
};
