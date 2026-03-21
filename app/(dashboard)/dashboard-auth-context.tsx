'use client';

import { createContext, useContext } from 'react';

export type DashboardUserProfile = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  company_id: string | null;
  company_name?: string | null;
  company_logo_url?: string | null;
};

export type AttentionCounts = {
  dueTodayPtps: number;
  brokenPtps: number;
  overdueCallbacks: number;
  staleAccounts: number;
};

type DashboardAuthContextValue = {
  checkingAuth: boolean;
  profile: DashboardUserProfile | null;
  attention: AttentionCounts;
};

const DashboardAuthContext = createContext<DashboardAuthContextValue>({
  checkingAuth: true,
  profile: null,
  attention: {
    dueTodayPtps: 0,
    brokenPtps: 0,
    overdueCallbacks: 0,
    staleAccounts: 0,
  },
});

export function DashboardAuthProvider({
  value,
  children,
}: {
  value: DashboardAuthContextValue;
  children: React.ReactNode;
}) {
  return (
    <DashboardAuthContext.Provider value={value}>
      {children}
    </DashboardAuthContext.Provider>
  );
}

export function useDashboardAuth() {
  return useContext(DashboardAuthContext);
}