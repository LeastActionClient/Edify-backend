import bcrypt from 'bcryptjs';
import { User, ActivityLog, Student, Application, Payment } from '../models/index.js';

export const createAdmin = async (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    const existing = await User.findOne({ username });
    if (existing) {
      res.status(400).json({ error: 'Username already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      password: hashedPassword,
      role: role || 'ADMIN'
    });

    await ActivityLog.create({
      userId: req.user.id,
      action: 'CREATED_ADMIN',
      details: `Admin ${username} created`
    });

    res.status(201).json({ message: 'Admin created successfully', user: { id: user.id, username } });
  } catch (error) {
    res.status(500).json({ error: 'Error creating admin' });
  }
};

export const updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, isActive } = req.body;

    const dataToUpdate = {};
    if (username) dataToUpdate.username = username;
    if (password) dataToUpdate.password = await bcrypt.hash(password, 10);
    if (isActive !== undefined) dataToUpdate.isActive = isActive;

    const user = await User.findByIdAndUpdate(id, dataToUpdate, { new: true });

    await ActivityLog.create({
      userId: req.user.id,
      action: 'UPDATED_ADMIN',
      details: `Admin ${user.username} updated`
    });

    res.json({ message: 'Admin updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error updating admin' });
  }
};

export const getAdmins = async (req, res) => {
  try {
    const admins = await User.find({}, 'id username role isActive createdAt lastActivity');

    const adminsWithLogin = await Promise.all(admins.map(async (admin) => {
      const lastLoginLog = await ActivityLog.findOne({ userId: admin.id, action: 'LOGGED_IN' }).sort({ timestamp: -1 });
      return {
        ...admin.toObject(),
        lastLogin: lastLoginLog ? lastLoginLog.timestamp : null
      };
    }));

    res.json(adminsWithLogin);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching admins' });
  }
};

export const getActivityLogs = async (req, res) => {
  try {
    const logs = await ActivityLog.find().populate('userId', 'username').sort({ timestamp: -1 });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching activity logs' });
  }
};

export const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const userToDelete = await User.findById(id);
    if (!userToDelete) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    await ActivityLog.deleteMany({ userId: id });
    await Student.updateMany({ addedById: id }, { $set: { addedById: null } });
    await Application.updateMany({ processedById: id }, { $set: { processedById: null } });
    await Payment.updateMany({ recordedById: id }, { $set: { recordedById: null } });

    await User.findByIdAndDelete(id);

    await ActivityLog.create({
      userId: req.user.id,
      action: 'DELETED_ADMIN',
      details: `Admin ${userToDelete.username} deleted`
    });

    res.json({ message: 'Admin deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error deleting admin' });
  }
};
