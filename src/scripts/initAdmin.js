import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import User from '../models/User.js';

// Charger les variables d'environnement
dotenv.config();

// Configuration de la connexion MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ebook';

// Fonction pour initialiser l'admin
async function initAdmin() {
  try {
    // Se connecter à la base de données
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connecté à la base de données MongoDB');

    // Vérifier si un admin existe déjà
    const adminExists = await User.findOne({ role: 'admin' });

    if (adminExists) {
      console.log('\n⚠️  Un compte administrateur existe déjà dans la base de données :');
      console.log('   Nom d\'utilisateur :', adminExists.username);
      console.log('   Date de création :', adminExists.createdAt);
      console.log('   ID :', adminExists._id);
      console.log('\nPour ajouter un nouvel administrateur, utilisez le panneau d\'administration.');
      process.exit(0);
    }

    // Demander les informations de l'admin
    const readline = await import('readline/promises');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log('\n=== Création du compte administrateur ===');
    const username = await rl.question('Nom d\'utilisateur admin: ');
    const password = await rl.question('Mot de passe (min 6 caractères): ', {
      hideEchoBack: true
    });

    if (password.length < 6) {
      console.error('Erreur: Le mot de passe doit contenir au moins 6 caractères');
      process.exit(1);
    }

    // Créer l'utilisateur admin (le mot de passe sera haché par le middleware pre('save') du modèle User)
    const admin = new User({
      username,
      password,
      role: 'admin'
    });

    await admin.save();
    console.log('\n✅ Compte administrateur créé avec succès !');
    console.log('Nom d\'utilisateur:', username);

    rl.close();
    process.exit(0);
  } catch (error) {
    console.error('Erreur lors de la création du compte admin:', error);
    process.exit(1);
  }
}

initAdmin();
