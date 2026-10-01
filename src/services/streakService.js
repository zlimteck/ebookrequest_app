import mongoose from 'mongoose';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Incrémente la série de jours consécutifs d'activité d'un utilisateur (gamification).
// Appelée en best-effort depuis les actions qui comptent comme "activité" (nouvelle
// demande, mise à jour de la bibliothèque de lecture) — ne doit jamais faire
// échouer l'appelant. `longest` est sticky (jamais décrémenté), comme les autres
// succès de l'app (voir issue #41).
export async function recordActivity(userId) {
  try {
    const User = mongoose.model('User');
    const user = await User.findById(userId).select('activityStreak');
    if (!user) return;

    const today = todayStr();
    const streak = user.activityStreak || {};
    if (streak.lastActiveDate === today) return; // déjà comptée aujourd'hui

    const current = streak.lastActiveDate === yesterdayStr() ? (streak.current || 0) + 1 : 1;
    const longest = Math.max(streak.longest || 0, current);

    await User.updateOne({ _id: userId }, { activityStreak: { current, longest, lastActiveDate: today } });
  } catch {
    // best-effort
  }
}
