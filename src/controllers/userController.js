import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma.js';

export const createAdmin = async (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      res.status(400).json({ error: 'Username already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        role: role || 'ADMIN'
      }
    });

    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATED_ADMIN',
        details: `Admin ${username} created`
      }
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

    const user = await prisma.user.update({
      where: { id: id  },
      data: dataToUpdate
    });

    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'UPDATED_ADMIN',
        details: `Admin ${user.username} updated`
      }
    });

    res.json({ message: 'Admin updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error updating admin' });
  }
};

export const getAdmins = async (req, res) => {
  try {
    const admins = await prisma.user.findMany({
      select: { id: true, username: true, role: true, isActive: true, createdAt: true, lastActivity: true }
    });

    // Fetch last login for each admin
    const adminsWithLogin = await Promise.all(admins.map(async (admin) => {
      const lastLoginLog = await prisma.activityLog.findFirst({
        where: { userId: admin.id, action: 'LOGGED_IN' },
        orderBy: { timestamp: 'desc' }
      });
      return {
        ...admin,
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
    const logs = await prisma.activityLog.findMany({
      include: { user: { select: { username: true } } },
      orderBy: { timestamp: 'desc' }
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching activity logs' });
  }
};

export const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    // Optional: prevent deleting oneself
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const userToDelete = await prisma.user.findUnique({ where: { id } });
    if (!userToDelete) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    // Handle foreign key constraints
    await prisma.activityLog.deleteMany({ where: { userId: id } });
    await prisma.student.updateMany({ where: { addedById: id }, data: { addedById: null } });
    await prisma.application.updateMany({ where: { processedById: id }, data: { processedById: null } });
    await prisma.payment.updateMany({ where: { recordedById: id }, data: { recordedById: null } });

    await prisma.user.delete({
      where: { id }
    });

    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'DELETED_ADMIN',
        details: `Admin ${userToDelete.username} deleted`
      }
    });

    res.json({ message: 'Admin deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error deleting admin' });
  }
};
