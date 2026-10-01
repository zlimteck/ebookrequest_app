import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosAdmin from '../axiosAdmin';
import styles from './ApiDocsPage.module.css';

// Même règle de slug que GitHub pour les ancres de titres (## Connecteurs (admin) →
// #connecteurs-admin), pour rester cohérent avec un éventuel lien direct vers API.md.
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

// Découpe le document en intro (avant la première ##) + une section par catégorie de
// routes (##...jusqu'à la ## suivante) — chaque section devient un bloc dépliant,
// recalculé à chaque chargement, jamais une liste figée à la main.
function splitSections(md) {
  const lines = md.split('\n');
  const intro = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      const label = line.slice(3).trim();
      current = { label, slug: slugify(label), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      intro.push(line);
    }
  }
  if (current) sections.push(current);

  return { intro, sections };
}

// Extrait "GET /api/xxx" d'un titre de route ("### `GET /api/users/me/stats`") si (et
// seulement si) c'est une GET sans paramètre d'URL (`:id`, `:token`...) — ce sont les
// seules routes qu'on propose de tester en un clic depuis la doc (voir TestableRoute),
// jamais POST/PUT/DELETE pour ne pas risquer de déclencher une vraie action en lisant
// la doc.
function extractTestableGet(headingText) {
  const match = headingText.match(/^`GET (\/api\/[^`]+)`/);
  if (!match) return null;
  const path = match[1];
  if (path.includes(':')) return null;
  return path;
}

// Bouton "Tester" sur une route GET : exécute la requête avec la session déjà
// authentifiée de l'utilisateur (même client que le reste de l'app, aucune nouvelle
// surface d'auth), le backend applique les mêmes permissions que pour n'importe quel
// autre appel — un user ne peut rien tester qui lui serait normalement interdit.
function TestableRoute({ path }) {
  const [state, setState] = useState({ status: 'idle', data: null });

  const run = async () => {
    setState({ status: 'loading', data: null });
    try {
      const res = await axiosAdmin.get(path);
      setState({ status: 'success', data: res.data });
    } catch (err) {
      setState({ status: 'error', data: err.response?.data || { error: err.message } });
    }
  };

  return (
    <div className={styles.testBlock}>
      <button type="button" className={styles.testBtn} onClick={run} disabled={state.status === 'loading'}>
        {state.status === 'loading' ? 'Test en cours…' : 'Tester cette route'}
      </button>
      {state.data && (
        <pre className={`${styles.codeBlock} ${styles.testResult} ${state.status === 'error' ? styles.testError : ''}`}>
          <code>{JSON.stringify(state.data, null, 2)}</code>
        </pre>
      )}
    </div>
  );
}

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

// Rendu markdown minimal pour un fragment (intro ou corps d'une section) : titres ###,
// gras, liens, listes, code inline et blocs de code ``` (API.md en contient beaucoup —
// toutes les commandes curl d'exemple). Pas de dépendance externe.
function renderBlocks(lines) {
  const blocks = [];
  let list = null;
  let codeLines = null;

  const flushList = () => {
    if (list) { blocks.push(<ul key={blocks.length}>{list}</ul>); list = null; }
  };

  lines.forEach((line, idx) => {
    if (line.startsWith('```')) {
      if (codeLines === null) {
        flushList();
        codeLines = [];
      } else {
        blocks.push(<pre key={idx} className={styles.codeBlock}><code>{codeLines.join('\n')}</code></pre>);
        codeLines = null;
      }
      return;
    }
    if (codeLines !== null) {
      codeLines.push(line);
      return;
    }
    if (line.startsWith('### ')) {
      flushList();
      const headingText = line.slice(4).trim();
      blocks.push(<h3 key={idx}>{renderInline(headingText)}</h3>);
      const testablePath = extractTestableGet(headingText);
      if (testablePath) blocks.push(<TestableRoute key={`${idx}-test`} path={testablePath} />);
    } else if (line.startsWith('- ')) {
      if (!list) list = [];
      list.push(<li key={idx}>{renderInline(line.slice(2))}</li>);
    } else if (line.trim() === '---') {
      flushList();
      blocks.push(<hr key={idx} />);
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

function ChevronIcon({ open }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', flexShrink: 0 }}>
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}

function SectionAccordion({ label, slug, lines, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);

  return (
    <div id={slug} className={styles.accordionItem}>
      <button type="button" className={styles.accordionHeader} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <ChevronIcon open={open} />
        <span>{label}</span>
      </button>
      {open && <div className={`${styles.markdown} ${styles.accordionBody}`}>{renderBlocks(lines)}</div>}
    </div>
  );
}

export default function ApiDocsPage() {
  const navigate = useNavigate();
  const [content, setContent] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    axiosAdmin.get('/api/docs/api')
      .then(res => setContent(res.data.content))
      .catch(() => setError(true));
  }, []);

  const { intro, sections } = content ? splitSections(content) : { intro: [], sections: [] };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <button className={styles.backBtn} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/dashboard'))}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Retour
        </button>
        {error && <p>Document introuvable.</p>}
        {content && (
          <>
            <div className={styles.markdown}>{renderBlocks(intro)}</div>
            <div className={styles.accordion}>
              {sections.map((s, i) => (
                <SectionAccordion key={s.slug} label={s.label} slug={s.slug} lines={s.lines} defaultOpen={i === 0} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
