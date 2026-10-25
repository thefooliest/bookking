import type { Location } from 'react-router-dom';
import { type FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

type LoginLocationState = {
  from?: Location;
};

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('cliente@bookking.local');
  const [password, setPassword] = useState('cliente123');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as LoginLocationState | null)?.from;

  if (user) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/mis-reservas'} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const loggedUser = await login({ email, password });
      const fallback = loggedUser.role === 'admin' ? '/admin' : '/mis-reservas';
      const target = from ? `${from.pathname}${from.search}` : fallback;
      navigate(target, { replace: true, state: from?.state });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'No fue posible iniciar sesión. Intenta de nuevo.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function useDemoUser(role: 'customer' | 'admin'): void {
    if (role === 'admin') {
      setEmail('admin@bookking.local');
      setPassword('admin123');
    } else {
      setEmail('cliente@bookking.local');
      setPassword('cliente123');
    }
  }

  return (
    <div className="auth-layout">
      <section className="page-heading">
        <p className="eyebrow">Acceso</p>
        <h1>Entra a Bookking</h1>
        <p className="lede">
          Inicia sesión para guardar tus reservas o administrar las del coworking.
        </p>
      </section>

      <div className="auth-grid">
        <form className="card form-card" onSubmit={handleSubmit}>
          <label className="field">
            <span>Correo</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="field">
            <span>Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <p className="error">{error}</p>}

          <button className="button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Ingresando...' : 'Iniciar sesión'}
          </button>
        </form>

        <section className="card demo-card">
          <p className="eyebrow">Usuarios sembrados</p>
          <h2>Prueba la app</h2>
          <p className="muted">
            Elige un perfil para completar el formulario con las credenciales demo.
          </p>
          <div className="demo-list">
            <button className="demo-user" type="button" onClick={() => useDemoUser('customer')}>
              <strong>Cliente</strong>
              <span>cliente@bookking.local · cliente123</span>
            </button>
            <button className="demo-user" type="button" onClick={() => useDemoUser('admin')}>
              <strong>Administrador</strong>
              <span>admin@bookking.local · admin123</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
