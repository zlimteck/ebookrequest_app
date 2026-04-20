// En monorepo, le frontend est servi par le backend sur la même origine.
// REACT_APP_API_URL est vide → axios fait des requêtes relatives (/api/...)
// En dev local, pointer vers le backend dev sur port 5001.
export const REACT_APP_API_URL =
  process.env.REACT_APP_API_URL !== undefined
    ? process.env.REACT_APP_API_URL
    : (process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '');
