import { Activity, StudentActivity } from '../models/index.js';

export const getActivities = async (req, res) => {
  try {
    const activities = await Activity.find()
      .populate('createdById', 'username')
      .sort({ createdAt: -1 });
    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
};

export const getActivityById = async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ error: 'Not found' });
    res.json(activity);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
};

export const createActivity = async (req, res) => {
  try {
    const { name, description, amount, status } = req.body;
    
    const existing = await Activity.findOne({ name });
    if (existing) {
      return res.status(400).json({ error: 'Activity with this name already exists' });
    }

    const activity = await Activity.create({
      name,
      description,
      amount: parseFloat(amount),
      status,
      createdById: req.user.id
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
    
    if (name) {
      const existing = await Activity.findOne({ name });
      if (existing && existing.id !== id) {
        return res.status(400).json({ error: 'Another activity with this name already exists' });
      }
    }

    const dataToUpdate = {};
    if (name !== undefined) dataToUpdate.name = name;
    if (description !== undefined) dataToUpdate.description = description;
    if (amount !== undefined) dataToUpdate.amount = parseFloat(amount);
    if (status !== undefined) dataToUpdate.status = status;

    const activity = await Activity.findByIdAndUpdate(id, dataToUpdate, { new: true });
    res.json(activity);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update activity' });
  }
};

export const deleteActivity = async (req, res) => {
  try {
    const { id } = req.params;
    
    const mappings = await StudentActivity.findOne({ activityId: id });

    if (mappings) {
      return res.status(400).json({ error: 'This Activity is already assigned to students and cannot be deleted.' });
    }

    await Activity.findByIdAndDelete(id);
    res.json({ message: 'Activity deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete activity' });
  }
};
