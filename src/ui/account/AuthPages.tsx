import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { emailProblem, passwordProblem, PASSWORD_MIN_LENGTH } from '../../cloud/auth';
import { primaryButton, textField } from '../styles';
import { useAuth } from './cloud';
import Notice from './Notice';
import PasswordField from './PasswordField';

const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters, with letters and numbers.`;

/** The frame every sign-in screen shares. */
function AuthFrame({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {intro && <p className="mt-2 text-gray-700">{intro}</p>}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        {children}
      </div>
    </div>
  );
}

/** Shown in place of a sign-in screen when this build has no accounts. */
export function AccountsUnavailable() {
  const { configError } = useAuth();
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Account</h1>
      <p className="mt-2 text-gray-700">
        Accounts and sync are not set up for this copy of Snap Notes. Everything you make is saved
        in this browser, and you can move it to another one with Export and Import on the home page.
      </p>
      {configError && (
        <Notice tone="warning" className="mt-4">
          {configError}
        </Notice>
      )}
    </div>
  );
}

function EmailField({
  value,
  onChange,
  error,
  inputRef,
}: {
  value: string;
  onChange(value: string): void;
  error?: string | null;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div>
      <label htmlFor="account-email" className="block text-sm font-medium text-gray-700">
        Email address
      </label>
      <input
        id="account-email"
        ref={inputRef}
        type="email"
        className={`${textField} mt-1`}
        value={value}
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'account-email-error' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <p id="account-email-error" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** Sends the user to their account once they are signed in. */
function useSignedInRedirect(): ReactNode {
  const { status } = useAuth();
  if (status === 'disabled') return <AccountsUnavailable />;
  if (status === 'signed-in') return <Navigate to="/account" replace />;
  return null;
}

export function SignInPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const redirect = useSignedInRedirect();
  if (redirect && !busy) return redirect;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const errors = {
      email: emailProblem(email) ?? undefined,
      password: password === '' ? 'Enter your password.' : undefined,
    };
    setFieldErrors(errors);
    if (errors.email || errors.password) {
      setError(null);
      (errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await auth.signIn(email, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    navigate('/account', { replace: true });
  }

  return (
    <AuthFrame
      title="Sign in"
      intro="Sign in to keep your cards and progress in step on every device you use."
    >
      {auth.sessionExpired && (
        <Notice tone="warning" role="status" className="mb-4">
          Your session ended. Sign in again to keep syncing. Everything on this browser is safe.
        </Notice>
      )}
      <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}
        <EmailField
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
          inputRef={emailRef}
        />
        <PasswordField
          id="account-password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          error={fieldErrors.password}
          inputRef={passwordRef}
        />
        <button type="submit" className={`${primaryButton} w-full`} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
        <Link to="/account/forgot-password" className="text-indigo-700 underline">
          Forgot your password?
        </Link>
        <Link to="/account/sign-up" className="text-indigo-700 underline">
          Create an account
        </Link>
      </div>
    </AuthFrame>
  );
}

export function SignUpPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSent, setConfirmSent] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const redirect = useSignedInRedirect();
  if (redirect && !busy) return redirect;

  if (confirmSent) {
    return (
      <AuthFrame title="Check your email">
        <p className="text-gray-700" role="status">
          We sent a link to <strong>{confirmSent}</strong>. Open it in this browser to confirm your
          address and finish creating your account.
        </p>
        <p className="mt-3 text-sm text-gray-600">
          Your cards stay on this browser in the meantime, and are uploaded once you are signed in.
        </p>
      </AuthFrame>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const errors = {
      email: emailProblem(email) ?? undefined,
      password: passwordProblem(password) ?? undefined,
    };
    setFieldErrors(errors);
    if (errors.email || errors.password) {
      setError(null);
      (errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await auth.signUp(email, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (result.value.needsConfirmation) {
      setConfirmSent(email.trim());
      return;
    }
    navigate('/account', { replace: true });
  }

  return (
    <AuthFrame
      title="Create an account"
      intro="Your cards and learning progress will sync across your devices. Nothing on this browser is removed."
    >
      <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
        {error && (
          <Notice tone="error" role="alert">
            {error}{' '}
            {error.includes('already exists') && (
              <Link to="/account/sign-in" className="underline">
                Sign in
              </Link>
            )}
          </Notice>
        )}
        <EmailField
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
          inputRef={emailRef}
        />
        <PasswordField
          id="account-new-password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={PASSWORD_HINT}
          error={fieldErrors.password}
          inputRef={passwordRef}
        />
        <button type="submit" className={`${primaryButton} w-full`} disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-sm">
        Already have an account?{' '}
        <Link to="/account/sign-in" className="text-indigo-700 underline">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const redirect = useSignedInRedirect();
  if (redirect) return redirect;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = emailProblem(email);
    setFieldError(problem);
    if (problem) return;
    setBusy(true);
    setError(null);
    const result = await auth.requestPasswordReset(email);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSent(true);
  }

  return (
    <AuthFrame
      title="Reset your password"
      intro="Enter the email address of your account and we will send you a link to choose a new password."
    >
      {sent ? (
        <div role="status">
          <p className="text-gray-700">
            If there is an account for <strong>{email.trim()}</strong>, a reset link is on its way.
            Open it in this browser. It works once, for a limited time.
          </p>
          <p className="mt-3 text-sm">
            <Link to="/account/sign-in" className="text-indigo-700 underline">
              Back to sign in
            </Link>
          </p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
          {error && (
            <Notice tone="error" role="alert">
              {error}
            </Notice>
          )}
          <EmailField value={email} onChange={setEmail} error={fieldError} />
          <button type="submit" className={`${primaryButton} w-full`} disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
          <p className="text-sm">
            <Link to="/account/sign-in" className="text-indigo-700 underline">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthFrame>
  );
}

export function ResetPasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Once the new password is saved, carry on to the account page.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => navigate('/account', { replace: true }), 1_500);
    return () => clearTimeout(timer);
  }, [done, navigate]);

  if (auth.status === 'disabled') return <AccountsUnavailable />;
  if (auth.status === 'loading') {
    return (
      <AuthFrame title="Choose a new password">
        <p role="status">Checking your link…</p>
      </AuthFrame>
    );
  }
  if (auth.status !== 'signed-in') {
    return (
      <AuthFrame title="Choose a new password">
        <Notice tone="error" role="alert">
          {auth.notice?.tone === 'error'
            ? auth.notice.text
            : 'This reset link has expired, was already used, or was opened in a different browser.'}
        </Notice>
        <p className="mt-4 text-sm">
          <Link to="/account/forgot-password" className="text-indigo-700 underline">
            Request a new link
          </Link>
        </p>
      </AuthFrame>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(password);
    setFieldError(problem);
    if (problem) return;
    setBusy(true);
    setError(null);
    const result = await auth.updatePassword(password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDone(true);
  }

  return (
    <AuthFrame
      title="Choose a new password"
      intro={auth.user?.email ? <>For {auth.user.email}.</> : undefined}
    >
      {done ? (
        <Notice tone="success" role="status">
          Your password has been changed.
        </Notice>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
          {error && (
            <Notice tone="error" role="alert">
              {error}
            </Notice>
          )}
          <PasswordField
            id="account-reset-password"
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint={PASSWORD_HINT}
            error={fieldError}
          />
          <button type="submit" className={`${primaryButton} w-full`} disabled={busy}>
            {busy ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}
