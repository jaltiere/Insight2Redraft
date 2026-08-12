const KEY = "i2r_token";

type TokenListener = (token: string | null) => void;
const listeners = new Set<TokenListener>();

export const getToken = () => localStorage.getItem(KEY);

export function setToken(t: string) {
  localStorage.setItem(KEY, t);
  notify();
}

export function clearToken() {
  localStorage.removeItem(KEY);
  notify();
}

export function subscribeToken(listener: TokenListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  const token = getToken();
  for (const listener of listeners) listener(token);
}
