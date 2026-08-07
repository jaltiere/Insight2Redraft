import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { isApiError } from "@/lib/api-client";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(isApiError(err) ? err.detail : "Login failed");
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-16 flex max-w-sm flex-col gap-3">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <label className="flex flex-col gap-1">
        Email
        <input className="border p-2" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        Password
        <input
          className="border p-2"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="border p-2" type="submit">
        Sign in
      </button>
    </form>
  );
}
