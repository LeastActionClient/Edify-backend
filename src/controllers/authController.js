import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, ActivityLog } from '../models/index.js';

export const login = async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = await User.findOne({ username });
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

    ActivityLog.create({
      userId: user.id,
      action: 'LOGGED_IN',
      details: `User ${user.username} logged in`
    }).catch((error) => {
      console.error('Failed to write login activity log', error);
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
    const offlineTime = new Date(Date.now() - 300001);
    await User.findByIdAndUpdate(req.user.id, { lastActivity: offlineTime });
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error during logout' });
  }
};
