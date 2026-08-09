import { useId, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Callout, Field } from '@hunt-maps/design';
import { useAuth, type ApiErrorKind } from '../../lib/api';
import { describeAuthError } from '../../lib/api/auth';
import { AuthShell } from './AuthShell';

interface AuthFormError {
  kind: ApiErrorKind | 'unexpected';
  message: string;
}

interface LocationState {
  from?: { pathname: string };
}

export function LoginScreen() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const emailId = useId();
  const passwordId = useId();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AuthFormError | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ email, password });
      const state = location.state as LocationState | null;
      navigate(state?.from?.pathname ?? '/', { replace: true });
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Terrain analytics, offline-first"
      title="Sign in"
      subtitle="Your stands, sign and saved filters — synced across devices, and still here with no signal."
      footer={
        <p className="auth-card__switch">
          No account yet? <Link to="/register">Register</Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        {error && (
          // A network failure and a rejected password read differently on
          // purpose (`CLAUDE.md`: "auth failure must not look like offline")
          // — `warn` here, never the `danger` tone a wrong password gets,
          // and the copy never implies the credentials themselves were bad.
          <Callout tone={error.kind === 'network' ? 'warn' : 'danger'} role="alert">
            {error.message}
          </Callout>
        )}

        <Field id={emailId} label="Email">
          <input
            id={emailId}
            className="rl-input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field id={passwordId} label="Password">
          <input
            id={passwordId}
            className="rl-input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" block disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}
