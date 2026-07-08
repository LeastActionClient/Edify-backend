import prisma from '../utils/prisma.js';

export const getActivities = async (req, res) => {
  try {
    const activities = await prisma.activity.findMany({
      include: {
        createdBy: {
          select: { username: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
};

export const getActivityById = async (req, res) => {
  try {
    const activity = await prisma.activity.findUnique({
      where: { id: req.params.id }
    });
    if (!activity) return res.status(404).json({ error: 'Not found' });
    res.json(activity);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
};

export const createActivity = async (req, res) => {
  try {
    const { name, description, amount, status } = req.body;
    
    const existing = await prisma.activity.findUnique({ where: { name } });
    if (existing) {
      return res.status(400).json({ error: 'Activity with this name already exists' });
    }

    const activity = await prisma.activity.create({
      data: {
        name,
        description,
        amount: parseFloat(amount),
        status,
        createdById: req.user.id
      }
    });
    res.status(201).json(activity);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create activity' });
  }
};

export const updateActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, amount, status } = req.body;
    
    // Check name uniqueness if name is changed
    if (name) {
      const existing = await prisma.activity.findUnique({ where: { name } });
      if (existing && existing.id !== id) {
        return res.status(400).json({ error: 'Another activity with this name already exists' });
      }
    }

    const dataToUpdate = {};
    if (name !== undefined) dataToUpdate.name = name;
    if (description !== undefined) dataToUpdate.description = description;
    if (amount !== undefined) dataToUpdate.amount = parseFloat(amount);
    if (status !== undefined) dataToUpdate.status = status;

    const activity = await prisma.activity.update({
      where: { id },
      data: dataToUpdate
    });
    res.json(activity);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update activity' });
  }
};

export const deleteActivity = async (req, res) => {
  try {
    const { id } = req.params;
    
    const mappings = await prisma.studentActivity.findFirst({
      where: { activityId: id }
    });

    if (mappings) {
      return res.status(400).json({ error: 'This Activity is already assigned to students and cannot be deleted.' });
    }

    await prisma.activity.delete({
      where: { id }
    });
    res.json({ message: 'Activity deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete activity' });
  }
};
