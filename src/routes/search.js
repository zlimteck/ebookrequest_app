import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import BookRequest from '../models/BookRequest.js';
import ReadingList from '../models/ReadingList.js';
import User from '../models/User.js';

const router = express.Router();
const MAX_PER_CAT = 5;

router.get('/', requireAuth, async (req, res) => {
  const q = req.query.q?.trim().slice(0, 100);
  if (!q || q.length < 2) return res.json({ results: {} });

  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const isAdmin = req.user.role === 'admin';
  const userId = req.user.id;

  const [myRequests, myReading, allRequests, users] = await Promise.all([
    BookRequest.find({
      user: userId,
      $or: [{ title: regex }, { author: regex }],
    }).select('title author status format createdAt').sort({ createdAt: -1 }).limit(MAX_PER_CAT).lean(),

    ReadingList.find({
      userId,
      $or: [{ title: regex }, { author: regex }],
    }).select('title author status readingProgress').limit(MAX_PER_CAT).lean(),

    isAdmin
      ? BookRequest.find({
          $or: [{ title: regex }, { author: regex }],
        }).select('title author status username createdAt').sort({ createdAt: -1 }).limit(MAX_PER_CAT).lean()
      : [],

    isAdmin
      ? User.find({
          $or: [{ username: regex }, { email: regex }],
        }).select('username email role lastActivity').limit(MAX_PER_CAT).lean()
      : [],
  ]);

  const results = {};
  if (myRequests.length)  results.demandes     = myRequests;
  if (myReading.length)   results.bibliotheque = myReading;
  if (allRequests.length) results.toutesLesDemandes = allRequests;
  if (users.length)       results.utilisateurs = users;

  res.json({ results });
});

export default router;
