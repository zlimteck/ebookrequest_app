import AppriseConfig from '../models/AppriseConfig.js';

const APPRISE_API_URL = process.env.APPRISE_URL || 'http://apprise:8000';

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
    try {
      const config = await this.getConfig();
      if (!config || !config.enabled || !config.notifyOnNewRequest) return;

      await this.sendNotification(
        '📚 Nouvelle demande d\'Ebook',
        `👤 ${user.username} a demandé un nouveau livre :\n\n📖 ${bookRequest.title}\n✍️ ${bookRequest.author}${bookRequest.link ? '\n🔗 ' + bookRequest.link : ''}`
      );
    } catch (error) {
      console.error('Erreur notification nouvelle demande:', error);
    }
  }
}

export default new AppriseService();