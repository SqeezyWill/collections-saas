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
    return (
      pathname === '/dashboard' ||
      pathname.startsWith('/accounts') ||
      pathname.startsWith('/collectors') ||
      pathname.startsWith('/payments') ||
      pathname.startsWith('/ptps') ||
      pathname.startsWith('/reports') ||
      pathname.startsWith('/strategies')
    );
  }

  if (normalizedRole === 'agent') {
    return (
      pathname === '/dashboard' ||
      pathname.startsWith('/accounts') ||
      pathname.startsWith('/payments') ||
      pathname.startsWith('/ptps')
    );
  }

  return false;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    let isMounted = true;

    if (!supabase) {
      router.replace('/login');
      return;
    }

    const client = supabase;

    async function checkSessionAndRole() {
      try {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();

        if (sessionError) {
          console.error('Dashboard layout session error:', sessionError);
          if (isMounted) {
            setCheckingAuth(false);
            router.replace('/login');
          }
          return;
        }

        const session = sessionData.session;

        if (!session) {
          if (isMounted) {
            setCheckingAuth(false);
            router.replace('/login');
          }
          return;
        }

        const userId = session.user?.id;
        if (!userId) {
          await client.auth.signOut();
          if (isMounted) {
            setCheckingAuth(false);
            router.replace('/login');
          }
          return;
        }

        const { data: profile, error } = await client
          .from('user_profiles')
          .select('id,name,email,role,company_id')
          .eq('id', userId)
          .maybeSingle();

        if (error) {
          console.error('Dashboard layout profile error:', error);
          await client.auth.signOut();
          if (isMounted) {
            setCheckingAuth(false);
            router.replace('/login');
          }
          return;
        }

        if (!profile) {
          console.error('Dashboard layout: no profile found for user', userId);
          await client.auth.signOut();
          if (isMounted) {
            setCheckingAuth(false);
            router.replace('/login');
          }
          return;
        }

        const userProfile = profile as UserProfile;
        const role = normalizeRole(userProfile.role);

        if (!isAllowedRoute(role, pathname)) {
          if (isMounted) {
            setCheckingAuth(false);
            router.replace('/dashboard');
          }
          return;
        }

        if (isMounted) {
          setCheckingAuth(false);
        }
      } catch (err) {
        console.error('Dashboard layout unexpected auth error:', err);
        if (isMounted) {
          setCheckingAuth(false);
          router.replace('/login');
        }
      }
    }

    checkSessionAndRole();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange(async (_event, session) => {
      try {
        if (!session) {
          setCheckingAuth(false);
          router.replace('/login');
          return;
        }

        const userId = session.user?.id;
        if (!userId) {
          setCheckingAuth(false);
          router.replace('/login');
          return;
        }

        const { data: profile, error } = await client
          .from('user_profiles')
          .select('role')
          .eq('id', userId)
          .maybeSingle();

        if (error) {
          console.error('Dashboard layout auth state profile error:', error);
          setCheckingAuth(false);
          router.replace('/login');
          return;
        }

        const role = normalizeRole(profile?.role);

        if (!isAllowedRoute(role, pathname)) {
          setCheckingAuth(false);
          router.replace('/dashboard');
          return;
        }

        setCheckingAuth(false);
      } catch (err) {
        console.error('Dashboard layout auth state unexpected error:', err);
        setCheckingAuth(false);
        router.replace('/login');
      }
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