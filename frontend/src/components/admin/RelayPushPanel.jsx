import React, { useEffect, useState } from 'react';
import styles from './RelayPushPanel.module.css';

const CheckIcon = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const AlertIcon = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);

// Appel direct au relais push (service tiers, pas le backend de cette
// instance) — jamais via axiosAdmin, qui pointe vers l'API locale. Le secret
// admin du relais n'est envoyé qu'à ce relais, jamais à notre backend.
async function relayFetch(relayUrl, secret, path, options = {}) {
  const res = await fetch(`${relayUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 503) {
    throw new Error('Ce relais n\'a pas de secret admin configuré (ADMIN_SECRET manquant côté relais).');
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Secret admin incorrect pour ce relais.');
  }
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { const data = await res.json(); msg = data.error || data.message || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// La forme exacte de la réponse (tableau brut ou objet enveloppé) n'est pas
// garantie côté relais — on gère les deux.
function relayList(data, keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) if (Array.isArray(data?.[k])) return data[k];
  return [];
}

export default function RelayPushPanel() {
  const [relayUrl, setRelayUrl] = useState('');
  const [relaySecret, setRelaySecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState([]);
  const [instances, setInstances] = useState([]);
  const [actingId, setActingId] = useState(null);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    const savedUrl = localStorage.getItem('relayPush_url') || '';
    const savedSecret = localStorage.getItem('relayPush_secret') || '';
    setRelayUrl(savedUrl);
    setRelaySecret(savedSecret);
    if (savedUrl && savedSecret) loadData(savedUrl, savedSecret);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 6000);
  };

  const loadData = async (url = relayUrl, secret = relaySecret) => {
    if (!url.trim() || !secret.trim()) {
      showAlertMsg('error', 'Renseigne l\'URL du relais et le secret admin.');
      return;
    }
    setLoading(true);
    setAlert(null);
    try {
      const [pendingData, instancesData] = await Promise.all([
        relayFetch(url, secret, '/admin/pending'),
        relayFetch(url, secret, '/admin/instances'),
      ]);
      setPending(relayList(pendingData, ['requests', 'pending', 'data']));
      setInstances(relayList(instancesData, ['instances', 'data']));
      setLoaded(true);
    } catch (err) {
      showAlertMsg('error', err.message || 'Impossible de contacter le relais.');
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAndLoad = async (e) => {
    e.preventDefault();
    const url = relayUrl.trim();
    const secret = relaySecret.trim();
    localStorage.setItem('relayPush_url', url);
    localStorage.setItem('relayPush_secret', secret);
    await loadData(url, secret);
  };

  const handleApprove = async (instanceId) => {
    setActingId(instanceId);
    try {
      await relayFetch(relayUrl, relaySecret, `/admin/approve/${instanceId}`, { method: 'POST' });
      showAlertMsg('success', 'Demande approuvée.');
      await loadData();
    } catch (err) {
      showAlertMsg('error', err.message || 'Erreur lors de l\'approbation.');
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (instanceId) => {
    setActingId(instanceId);
    try {
      await relayFetch(relayUrl, relaySecret, `/admin/reject/${instanceId}`, { method: 'POST' });
      showAlertMsg('success', 'Demande rejetée.');
      await loadData();
    } catch (err) {
      showAlertMsg('error', err.message || 'Erreur lors du rejet.');
    } finally {
      setActingId(null);
    }
  };

  const formatDate = d => d ? new Date(d).toLocaleString('fr-FR') : '—';

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>
          </svg>
          Relais push
        </h2>
        <p className={styles.panelSubtitle}>
          Approuve ou rejette les instances qui demandent l'accès au relais push iOS.{' '}
          <a href="https://github.com/zlimteck/ebookrequest-apns-relay" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>
            Voir le dépôt ebookrequest-apns-relay
          </a>
        </p>
      </div>

      <div className={styles.card}>
        <form className={styles.form} onSubmit={handleSaveAndLoad}>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>URL du relais</label>
            <input
              className={styles.fieldInput}
              type="text"
              placeholder="https://push-relay.mondomaine.fr"
              value={relayUrl}
              onChange={e => setRelayUrl(e.target.value)}
            />
          </div>

          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Secret admin (ADMIN_SECRET)</label>
            <input
              className={styles.fieldInput}
              type="password"
              autoComplete="off"
              placeholder="Secret admin du relais"
              value={relaySecret}
              onChange={e => setRelaySecret(e.target.value)}
            />
            <p className={styles.fieldHint}>Stocké uniquement dans ce navigateur, jamais envoyé au backend de cette instance, seulement au relais.</p>
          </div>

          {alert && (
            <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
              {alert.type === 'success' ? <CheckIcon /> : <AlertIcon />}
              {alert.message}
            </div>
          )}

          <div className={styles.cardActions}>
            <button type="submit" className={styles.btnPrimary} disabled={loading}>
              {loading ? 'Chargement…' : 'Enregistrer et charger'}
            </button>
          </div>
        </form>
      </div>

      {loaded && (
        <>
          <div className={`${styles.card} ${styles.relaySection}`}>
            <p className={styles.relaySectionTitle}>
              Demandes en attente ({pending.length})
            </p>
            {pending.length === 0 ? (
              <p className={styles.fieldHint}>Aucune demande en attente.</p>
            ) : (
              <div className={styles.relayList}>
                {pending.map(p => {
                  const id = p.instanceId || p.id;
                  return (
                    <div key={id} className={styles.relayRow}>
                      <div className={styles.relayRowInfo}>
                        <p className={styles.relayRowLabel}>{p.label || id}</p>
                        <p className={styles.relayRowMeta}>
                          {p.domain ? `${p.domain} · ` : ''}demandé le {formatDate(p.requestedAt || p.createdAt)}
                        </p>
                      </div>
                      <div className={styles.relayRowActions}>
                        <button type="button" className={styles.btnTest} disabled={actingId === id} onClick={() => handleApprove(id)}>
                          {actingId === id ? '…' : 'Approuver'}
                        </button>
                        <button type="button" className={styles.btnDanger} disabled={actingId === id} onClick={() => handleReject(id)}>
                          {actingId === id ? '…' : 'Rejeter'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={`${styles.card} ${styles.relaySection}`}>
            <p className={styles.relaySectionTitle}>
              Instances actives ({instances.length})
            </p>
            {instances.length === 0 ? (
              <p className={styles.fieldHint}>Aucune instance active.</p>
            ) : (
              <div className={styles.relayList}>
                {instances.map(i => {
                  const id = i.instanceId || i.id;
                  const parts = [];
                  if (i.domain) parts.push(i.domain);
                  if (i.contactEmail) parts.push(i.contactEmail);
                  if (i.approvedAt) parts.push(`approuvée le ${formatDate(i.approvedAt)}`);
                  return (
                    <div key={id} className={styles.relayRow}>
                      <div className={styles.relayRowInfo}>
                        <p className={styles.relayRowLabel}>{i.label || id}</p>
                        {parts.length > 0 && (
                          <p className={styles.relayRowMeta}>{parts.join(' · ')}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
