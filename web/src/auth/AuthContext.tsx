import type { AuthResponse, AuthUser, LoginRequest } from '@bookking/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext } from 'react';
import { apiFetch } from '../api/client';

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (input: LoginRequest) => Promise<AuthUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const authQuery = useQuery({
    queryKey: ['auth'],
    queryFn: () => apiFetch<AuthResponse>('/api/auth/me'),
    retry: false,
    staleTime: 30_000
  });

  async function login(input: LoginRequest): Promise<AuthUser> {
    const response = await apiFetch<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input)
    });

    if (!response.user) {
      throw new Error('El servidor no devolvió el usuario autenticado.');
    }

    queryClient.setQueryData<AuthResponse>(['auth'], response);
    return response.user;
  }

  async function logout(): Promise<void> {
    await apiFetch<void>('/api/auth/logout', { method: 'POST' });
    queryClient.clear();
    queryClient.setQueryData<AuthResponse>(['auth'], { user: null });
  }

  return (
    <AuthContext.Provider
      value={{
        user: authQuery.data?.user ?? null,
        isLoading: authQuery.isPending,
        login,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
