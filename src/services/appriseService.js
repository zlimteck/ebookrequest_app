import AppriseConfig from '../models/AppriseConfig.js';

const APPRISE_API_URL = (process.env.APPRISE_URL || 'http://apprise:8000').replace(/\/notify\/?$/, '');

class AppriseService {

  // Parse les URLs Apprise (une par ligne, ignorer les lignes vides/commentaires)
  _parseUrls(appriseUrls) {
    if (!appriseUrls) return [];
    return appriseUrls
      .split('\n')
      .map(u => u.trim())
      .filter(u => u && !u.startsWith('#'));
  }

  async getConfig() {
    try {
      return await AppriseConfig.findOne({}).lean();
    } catch (error) {
      console.error('Erreur récupération config Apprise:', error);
      return null;
    }
  }

  async updateConfig(newConfig) {
    try {
      let config = await AppriseConfig.findOne({});
      if (!config) {
        config = new AppriseConfig(newConfig);
      } else {
        Object.assign(config, newConfig);
        config.lastUpdated = new Date();
      }
      await config.save();
      return config;
    } catch (error) {
      console.error('Erreur mise à jour config Apprise:', error);
      throw error;
    }
  }

  async sendNotification(title, message) {
    try {
      const config = await this.getConfig();
      if (!config || !config.enabled) {
        console.log('Apprise désactivé — notification ignorée.');
        return { success: false, message: 'Apprise non configuré' };
      }

      const urls = this._parseUrls(config.appriseUrls);
      if (urls.length === 0) {
        console.log('Aucune URL Apprise configurée.');
        return { success: false, message: 'Aucune URL Apprise configurée' };
      }

      const response = await fetch(`${APPRISE_API_URL}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, title, body: message }),
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        console.log('✅ Notification Apprise envoyée');
        return { success: true };
      } else {
        const text = await response.text();
        console.error('❌ Erreur Apprise API:', response.status, text);
        return { success: false, message: `Apprise API error: ${response.status}` };
      }
    } catch (error) {
      console.error('❌ Erreur envoi notification Apprise:', error.message);
      return { success: false, error };
    }
  }

  async notifyNewBookRequest(bookRequest, user) {
    const config = await this.getConfig();
    if (!config?.enabled || !config.notifyOnNewRequest) return;
    await this.sendNotification(
      '📚 Nouvelle demande d\'Ebook',
      `👤 ${user.username} a demandé un nouveau livre :\n\n📖 ${bookRequest.title}\n✍️ ${bookRequest.author}${bookRequest.link ? '\n🔗 ' + bookRequest.link : ''}`
    );
  }

  async notifyBookCompleted(bookRequest) {
    const config = await this.getConfig();
    if (!config?.enabled || !config.notifyOnComplete) return;
    await this.sendNotification(
      '✅ Livre disponible',
      `📖 "${bookRequest.title}" de ${bookRequest.author}\n👤 Demandé par : ${bookRequest.username}`
    );
  }

  async notifyBookCanceled(bookRequest, reason) {
    const config = await this.getConfig();
    if (!config?.enabled || !config.notifyOnCancel) return;
    await this.sendNotification(
      '❌ Demande annulée',
      `📖 "${bookRequest.title}"\n👤 Utilisateur : ${bookRequest.username}${reason ? '\n💬 Raison : ' + reason : ''}`
    );
  }

  async notifyUserComment(bookRequest, comment) {
    const config = await this.getConfig();
    if (!config?.enabled || !config.notifyOnComment) return;
    await this.sendNotification(
      '💬 Nouveau commentaire utilisateur',
      `📖 "${bookRequest.title}"\n👤 ${bookRequest.username} : ${comment.substring(0, 200)}`
    );
  }

  async notifyReport(bookRequest, reason) {
    const config = await this.getConfig();
    if (!config?.enabled || !config.notifyOnReport) return;
    await this.sendNotification(
      '⚠️ Signalement d\'un problème',
      `📚 Livre: ${bookRequest.title}\n👤 Utilisateur: ${bookRequest.username}\n⚠️ Raison: ${reason}`
    );
  }

  async notifyNewUser(username, email) {
    const config = await this.getConfig();
    if (!config?.enabled || !config.notifyOnNewUser) return;
    await this.sendNotification(
      '👤 Nouvel utilisateur inscrit',
      `${username}${email ? ' — ' + email : ''}`
    );
  }

  // ── Notifications personnelles utilisateur ────────────────────────────────
  async sendUserNotification(user, title, message) {
    try {
      const globalConfig = await this.getConfig();
      if (!globalConfig?.enabled) return;

      const apprise = user.notificationPreferences?.apprise;
      if (!apprise?.enabled) return;

      const urls = this._parseUrls(apprise.urls);
      if (urls.length === 0) return;

      const response = await fetch(`${APPRISE_API_URL}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, title, body: message }),
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        console.log(`✅ Notification Apprise user (${user.username}) envoyée`);
      } else {
        const text = await response.text();
        console.error(`❌ Erreur Apprise user: ${response.status}`, text);
      }
    } catch (error) {
      console.error('❌ Erreur notification Apprise user:', error.message);
    }
  }

  async notifyUserBookCompleted(user, bookRequest) {
    if (user.notificationPreferences?.apprise?.notifyOnComplete === false) return;
    await this.sendUserNotification(user,
      '✅ Livre disponible',
      `📖 "${bookRequest.title}" est prêt au téléchargement.`
    );
  }

  async notifyUserBookCanceled(user, bookRequest, reason) {
    if (user.notificationPreferences?.apprise?.notifyOnCancel === false) return;
    await this.sendUserNotification(user,
      '❌ Demande annulée',
      `📖 "${bookRequest.title}"${reason ? '\n💬 Raison : ' + reason : ''}`
    );
  }

  async notifyUserAdminComment(user, bookRequest, comment) {
    if (user.notificationPreferences?.apprise?.notifyOnAdminComment === false) return;
    await this.sendUserNotification(user,
      '💬 Nouveau commentaire',
      `📖 "${bookRequest.title}"\n${comment.substring(0, 200)}`
    );
  }
}

export default new AppriseService();