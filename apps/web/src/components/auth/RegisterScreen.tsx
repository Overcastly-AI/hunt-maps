import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Callout, Field } from '@hunt-maps/design';
import { useAuth, type ApiErrorKind } from '../../lib/api';
import { describeAuthError } from '../../lib/api/auth';
import { AuthShell } from './AuthShell';

interface AuthFormError {
  kind: ApiErrorKind | 'unexpected';
  message: string;
}

export function RegisterScreen() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AuthFormError | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register({ email, password, displayName });
      navigate('/', { replace: true });
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Terrain analytics, offline-first"
      title="Create an account"
      subtitle="One account covers every device — the phone at the trailhead and the laptop at camp both see the same stands and filters."
      footer={
        <p className="auth-card__switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        {error && (
          <Callout tone={error.kind === 'network' ? 'warn' : 'danger'} role="alert">
            {error.message}
          </Callout>
        )}

        <Field id={nameId} label="Name">
          <input
            id={nameId}
            className="rl-input"
            type="text"
            autoComplete="name"
            required
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>

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

        <Field
          id={passwordId}
          label="Password"
          hint="12 characters minimum. No symbols required — length beats composition rules, and this is an app you need to get into standing in the dark."
        >
          <input
            id={passwordId}
            className="rl-input"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" block disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
}
