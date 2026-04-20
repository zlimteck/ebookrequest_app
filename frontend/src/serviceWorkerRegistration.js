// Convertit une clé VAPID base64 en Uint8Array pour pushManager.subscribe()
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Enregistre le service worker
export function register() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('[SW] Enregistré, scope:', reg.scope);
    } catch (err) {
      console.error('[SW] Échec enregistrement:', err);
    }
  });
}

// Retourne true si l'utilisateur est abonné aux push
export async function isPushSubscribed() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

// Abonne l'utilisateur aux push et envoie la souscription au backend
export async function subscribeToPush(apiUrl) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push non supporté sur ce navigateur');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Permission refusée');
  }

  // Récupère la clé VAPID publique depuis le backend
  const keyRes = await fetch(`${apiUrl}/api/push/vapid-key`);
  const { publicKey } = await keyRes.json();

  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });

  // Envoie la souscription au backend
  const token = localStorage.getItem('token');
  await fetch(`${apiUrl}/api/push/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ subscription })
  });

  return subscription;
}

// Désabonne l'utilisateur des push
export async function unsubscribeFromPush(apiUrl) {
  if (!('serviceWorker' in navigator)) return;

  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();

  const token = localStorage.getItem('token');
  await fetch(`${apiUrl}/api/push/unsubscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ endpoint })
  });
}