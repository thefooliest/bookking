import { APP_NAME } from '@bookking/shared';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Route, Routes } from 'react-router-dom';

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

  return (
    <section className="card">
      <p className="eyebrow">Reservas de salas</p>
      <h1>Cotiza y reserva tu sala</h1>
      <p className="lede">
        Elige una sala, calcula el precio y confirma tu reserva en pocos pasos.
      </p>
      <div className={`status ${health.isSuccess ? 'ok' : 'offline'}`}>
        {health.isPending && 'Comprobando la API...'}
        {health.isError && 'API no disponible. Levanta el backend con npm run dev:api.'}
        {health.isSuccess && `API conectada: ${health.data.app}`}
      </div>
    </section>
  );
}

export function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          {APP_NAME}
        </NavLink>
        <nav>
          <NavLink to="/">Inicio</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
        </Routes>
      </main>
    </div>
  );
}
