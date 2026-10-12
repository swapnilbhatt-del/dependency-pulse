"use client";

import { useActionState } from "react";
import { loginAction, type ActionResult } from "@/app/admin/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(loginAction, null);
  const error = state && !state.ok ? state.error : null;
  return (
    <form action={action} className="mt-8 space-y-4" noValidate>
      <div>
        <label htmlFor="password" className="label">
          Admin password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "password-error" : undefined}
          autoFocus
        />
        <p id="password-error" className="field-error min-h-5" role="alert" aria-live="assertive">
          {error ?? ""}
        </p>
      </div>
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-xs text-ink-3">After 5 failed attempts, sign-in pauses for 15 minutes.</p>
    </form>
  );
}
