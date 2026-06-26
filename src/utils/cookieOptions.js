const isHttps = process.env.FRONTEND_URL?.startsWith('https://');

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isHttps,
  sameSite: isHttps ? 'strict' : 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
};

export const clearCookieOptions = () => ({
  path: '/',
  sameSite: isHttps ? 'strict' : 'lax',
  secure: isHttps,
});
