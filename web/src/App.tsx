import { APP_NAME } from '@bookking/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { AdminBookingsPage } from './pages/AdminBookingsPage';
import { BookingWizardPage } from './pages/BookingWizardPage';
import { LoginPage } from './pages/LoginPage';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { QuotePage } from './pages/QuotePage';

type HealthResponse = {
  status: string;
  app: string;
};

async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health');
  if (!response.ok) {
    throw new Error('API no disponible');
  }
  return (await response.json()) as HealthResponse;
}

function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: false });
  const { user } = useAuth();

  return (
    <section className="card home-card">
      <p className="eyebrow">Reservas de salas</p>
      <h1>Cotiza y reserva tu sala</h1>
      <p className="lede">
        Elige una sala, calcula el precio y confirma tu reserva en pocos pasos.
      </p>
      <div className="actions">
        <Link className="button" to="/cotizar">
          Cotizar una sala
        </Link>
        {user && (
          <Link className="button secondary" to={user.role === 'admin' ? '/admin' : '/mis-reservas'}>
            {user.role === 'admin' ? 'Ver reservas' : 'Mis reservas'}
          </Link>
        )}
      </div>
      <div className={`status ${health.isSuccess ? 'ok' : 'offline'}`}>
        {health.isPending && 'Comprobando la API...'}
        {health.isError && 'API no disponible. Levanta el backend con npm run dev:api.'}
        {health.isSuccess && `API conectada: ${health.data.app}`}
      </div>
    </section>
  );
}

function Topbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/');
  }

  return (
    <header className="topbar">
      <NavLink to="/" className="brand">
        {APP_NAME}
      </NavLink>
      <nav>
        <NavLink to="/" end>
          Inicio
        </NavLink>
        <NavLink to="/cotizar">Cotizar</NavLink>
        {user?.role === 'customer' && <NavLink to="/mis-reservas">Mis reservas</NavLink>}
        {user?.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
        {!user && <NavLink to="/login">Ingresar</NavLink>}
        {user && (
          <>
            <span className="nav-user">{user.fullName}</span>
            <button className="link-button" type="button" onClick={handleLogout}>
              Salir
            </button>
          </>
        )}
      </nav>
    </header>
  );
}

export function App() {
  return (
    <div className="shell">
      <Topbar />
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/cotizar" element={<QuotePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/reservar"
            element={
              <RequireAuth role="customer">
                <BookingWizardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/reservar/:id"
            element={
              <RequireAuth role="customer">
                <BookingWizardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/mis-reservas"
            element={
              <RequireAuth role="customer">
                <MyBookingsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAuth role="admin">
                <AdminBookingsPage />
              </RequireAuth>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
