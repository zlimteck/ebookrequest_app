// Écran de consentement minimal, servi par mcp/ lui-même (pas de pipeline
// frontend dans ce service). Affiche le domaine réel du redirect_uri en
// plus du client_name : le nom déclaré par un client est purement
// déclaratif à l'enregistrement dynamique (RFC 7591), n'importe qui peut se
// faire appeler "Claude" — seul le domaine de redirection est une donnée
// vérifiée (enregistrée, comparée à la requête d'autorisation).
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderConsentPage({ pendingId, csrfToken, clientName, redirectUri }) {
  let redirectDomain = redirectUri;
  try {
    redirectDomain = new URL(redirectUri).host;
  } catch { /* garde la valeur brute si jamais invalide */ }

  const safeClientName = escapeHtml(clientName || 'Une application tierce');
  const safeDomain = escapeHtml(redirectDomain);
  const safePendingId = escapeHtml(pendingId);
  const safeCsrf = escapeHtml(csrfToken);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Autoriser l'accès — EbookRequest</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #1e293b; border: 1px solid #2d3748; border-radius: 12px; padding: 2rem; max-width: 420px; width: 90%; }
  h1 { font-size: 1.1rem; margin: 0 0 1rem; }
  p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; }
  .domain { color: #6366f1; font-weight: 600; }
  .actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
  button { flex: 1; padding: 0.7rem; border-radius: 8px; border: 1px solid #2d3748; font-size: 0.9rem; cursor: pointer; }
  .allow { background: #6366f1; color: #fff; border-color: #6366f1; }
  .deny { background: transparent; color: #f8fafc; }
</style>
</head>
<body>
  <div class="card">
    <h1>${safeClientName} souhaite accéder à votre compte EbookRequest</h1>
    <p>Vous serez redirigé vers <span class="domain">${safeDomain}</span> après votre décision. Vous pourrez révoquer cet accès à tout moment depuis vos paramètres.</p>
    <form method="POST" action="/authorize/consent">
      <input type="hidden" name="pending" value="${safePendingId}">
      <input type="hidden" name="csrf" value="${safeCsrf}">
      <div class="actions">
        <button type="submit" name="decision" value="deny" class="deny">Refuser</button>
        <button type="submit" name="decision" value="allow" class="allow">Autoriser</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}

// Anti-clickjacking : cet écran autorise un accès réel au compte, jamais
// embarquable dans une iframe d'un site tiers.
export function setAntiClickjackingHeaders(res) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
}
