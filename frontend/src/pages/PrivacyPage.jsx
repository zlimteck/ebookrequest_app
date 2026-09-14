import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosAdmin from '../axiosAdmin';
import styles from './PrivacyPage.module.css';

// Rendu markdown minimal, volontairement pas de dépendance externe : le
// contenu de PRIVACY.md n'utilise que titres/gras/liens/listes/code inline.
function renderMarkdown(md) {
  const lines = md.split('\n');
  const blocks = [];
  let list = null;

  const renderInline = (text) => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i}>{part.slice(1, -1)}</code>;
      }
      const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer">{linkMatch[1]}</a>;
      }
      return part;
    });
  };

  const flushList = () => {
    if (list) { blocks.push(<ul key={blocks.length}>{list}</ul>); list = null; }
  };

  lines.forEach((line, idx) => {
    if (line.startsWith('### ')) { flushList(); blocks.push(<h3 key={idx}>{renderInline(line.slice(4))}</h3>); }
    else if (line.startsWith('## '))  { flushList(); blocks.push(<h2 key={idx}>{renderInline(line.slice(3))}</h2>); }
    else if (line.startsWith('# '))   { flushList(); blocks.push(<h1 key={idx}>{renderInline(line.slice(2))}</h1>); }
    else if (line.startsWith('- ')) {
      if (!list) list = [];
      list.push(<li key={idx}>{renderInline(line.slice(2))}</li>);
    } else if (line.trim() === '') {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={idx}>{renderInline(line)}</p>);
    }
  });
  flushList();
  return blocks;
}

export default function PrivacyPage() {
  const navigate = useNavigate();
  const [content, setContent] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    axiosAdmin.get('/api/legal/privacy')
      .then(res => setContent(res.data.content))
      .catch(() => setError(true));
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Retour
        </button>
        {error && <p>Document introuvable.</p>}
        {content && <div className={styles.markdown}>{renderMarkdown(content)}</div>}
      </div>
    </div>
  );
}
