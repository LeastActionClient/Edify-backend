import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';

export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid credentials or account disabled' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1d' }
    );

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'LOGGED_IN',
        details: `User ${user.username} logged in`
      }
    });

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error during login' });
  }
};

export const logout = async (req, res) => {
  try {
    // Set lastActivity to 5 minutes and 1 second ago so they appear offline immediately
    const offlineTime = new Date(Date.now() - 300001);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { lastActivity: offlineTime }
    });
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error during logout' });
  }
};
