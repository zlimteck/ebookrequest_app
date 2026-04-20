import mongoose from 'mongoose';
import User from '../models/User.js';

const MONGODB_URI = process.env.MONGODB_URI;

async function fixActive() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connecté à MongoDB');

  const users = await User.find({ isActive: false });
  console.log(`Utilisateurs désactivés trouvés : ${users.length}`);
  users.forEach(u => console.log(' -', u.username));

  const result = await User.updateMany({ isActive: false }, { $set: { isActive: true } });
  console.log(`Comptes réactivés : ${result.modifiedCount}`);

  await mongoose.disconnect();
  process.exit(0);
}

fixActive().catch(e => { console.error(e); process.exit(1); });
