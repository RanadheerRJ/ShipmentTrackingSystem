const API_BASE = import.meta.env.VITE_API_BASE || '/api';

let token: string | null = localStorage.getItem('uscis_token') || null;

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('uscis_token', t);
  else localStorage.removeItem('uscis_token');
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  setToken(data.token);
  return data;
}

export function authFetch(input: RequestInfo, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(typeof input === 'string' ? `${API_BASE}${input.startsWith('/') ? '' : ''}${input}` : input, { ...init, headers });
}

export async function me() {
  if (!token) return null;
  const res = await authFetch('/auth/me');
  if (!res.ok) return null;
  const data = await res.json();
  return data.user || null;
}

export default { login, setToken, authFetch, me };
