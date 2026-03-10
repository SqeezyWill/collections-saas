'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { supabase } from '@/lib/supabase';

type UserProfile = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  company_id: string | null;
};

function normalizeRole(role: string | null | undefined) {
  return String(role || '').trim().toLowerCase();
}

function isAllowedRoute(role: string, pathname: string) {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === 'super_admin') return true;

  if (normalizedRole === 'admin') {
    if (
      pathname === '/dashboard' ||
      pathname.startsWith('/accounts') ||
      pathname.startsWith('/collectors') ||
      pathname.startsWith('/payments') ||
      pathname.startsWith('/ptps') ||
      pathname.startsWith('/reports') ||
      pathname.startsWith('/strategies')
    ) {
      return true;
    }
    return false;
  }

  if (normalizedRole === 'agent') {
    if (
      pathname === '/dashboard' ||
      pathname.startsWith('/accounts') ||
      pathname.startsWith('/payments') ||
      pathname.startsWith('/ptps')
    ) {
      return true;
    }
    return false;
  }

  return false;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function checkSessionAndRole() {
      if (!supabase) {
        if (isMounted) router.replace('/login');
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;

      if (!session) {
        if (isMounted) router.replace('/login');
        return;
      }

      const userId = session.user?.id;
      if (!userId) {
        await supabase.auth.signOut();
        if (isMounted) router.replace('/login');
        return;
      }

      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('id,name,email,role,company_id')
        .eq('id', userId)
        .maybeSingle();

      if (error || !profile) {
        await supabase.auth.signOut();
        if (isMounted) router.replace('/login');
        return;
      }

      const userProfile = profile as UserProfile;
      const role = normalizeRole(userProfile.role);

      if (!isAllowedRoute(role, pathname)) {
        if (isMounted) {
          router.replace('/dashboard');
        }
        return;
      }

      if (isMounted) {
        setCheckingAuth(false);
      }
    }

    checkSessionAndRole();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        router.replace('/login');
        return;
      }

      const userId = session.user?.id;
      if (!userId) {
        router.replace('/login');
        return;
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();

      const role = normalizeRole(profile?.role);

      if (!isAllowedRoute(role, pathname)) {
        router.replace('/dashboard');
        return;
      }

      setCheckingAuth(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [router, pathname]);

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600 shadow-sm">
          Checking access...
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}