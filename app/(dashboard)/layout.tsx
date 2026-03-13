'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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

type AttentionCounts = {
  dueTodayPtps: number;
  brokenPtps: number;
  overdueCallbacks: number;
  staleAccounts: number;
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

function toDateOnly(value: string | null | undefined) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function isToday(dateValue: string | null | undefined) {
  if (!dateValue) return false;

  const iso = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let date: Date;

  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    date = new Date(year, month - 1, day);
  } else {
    date = new Date(dateValue);
  }

  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isPastDue(dateValue: string | null | undefined) {
  if (!dateValue) return false;
  const dateOnly = toDateOnly(dateValue);
  const today = toDateOnly(new Date().toISOString());
  return Boolean(dateOnly) && dateOnly < today;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [attention, setAttention] = useState<AttentionCounts>({
    dueTodayPtps: 0,
    brokenPtps: 0,
    overdueCallbacks: 0,
    staleAccounts: 0,
  });

  useEffect(() => {
    let isMounted = true;

    if (!supabase) {
      router.replace('/login');
      return;
    }

    const client = supabase;

    async function loadAttention(companyId: string) {
      try {
        const [{ data: ptps }, { data: accounts }] = await Promise.all([
          client.from('ptps').select('status,promised_date').eq('company_id', companyId),
          client
            .from('accounts')
            .select('status,next_action_date,last_action_date')
            .eq('company_id', companyId),
        ]);

        if (!isMounted) return;

        const dueTodayPtps = (ptps ?? []).filter(
          (ptp: any) => ptp.status === 'Promise To Pay' && isToday(ptp.promised_date)
        ).length;

        const brokenPtps = (ptps ?? []).filter((ptp: any) => ptp.status === 'Broken').length;

        const overdueCallbacks = (accounts ?? []).filter(
          (account: any) =>
            account.status === 'Callback Requested' && isPastDue(account.next_action_date)
        ).length;

        const staleAccounts = (accounts ?? []).filter((account: any) => {
          if (!account.last_action_date) return true;
          return isPastDue(account.last_action_date);
        }).length;

        setAttention({
          dueTodayPtps,
          brokenPtps,
          overdueCallbacks,
          staleAccounts,
        });
      } catch (error) {
        console.error('Dashboard layout attention load error:', error);
      }
    }

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

        const { data: profileData, error } = await client
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

        if (!profileData) {
          console.error('Dashboard layout: no profile found for user', userId);
          await client.auth.signOut();
          if (isMounted) {
            setCheckingAuth(false);
            router.replace('/login');
          }
          return;
        }

        const userProfile = profileData as UserProfile;
        const role = normalizeRole(userProfile.role);

        if (!isAllowedRoute(role, pathname)) {
          if (isMounted) {
            setCheckingAuth(false);
            router.replace('/dashboard');
          }
          return;
        }

        if (isMounted) {
          setProfile(userProfile);
          setCheckingAuth(false);
        }

        if (userProfile.company_id) {
          await loadAttention(userProfile.company_id);
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

        const { data: profileData, error } = await client
          .from('user_profiles')
          .select('id,name,email,role,company_id')
          .eq('id', userId)
          .maybeSingle();

        if (error) {
          console.error('Dashboard layout auth state profile error:', error);
          setCheckingAuth(false);
          router.replace('/login');
          return;
        }

        const role = normalizeRole(profileData?.role);

        if (!isAllowedRoute(role, pathname)) {
          setCheckingAuth(false);
          router.replace('/dashboard');
          return;
        }

        setProfile((profileData as UserProfile) || null);
        setCheckingAuth(false);

        if (profileData?.company_id) {
          await loadAttention(profileData.company_id);
        }
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

  const totalAttention = useMemo(
    () =>
      attention.dueTodayPtps +
      attention.brokenPtps +
      attention.overdueCallbacks +
      attention.staleAccounts,
    [attention]
  );

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

        {profile?.company_id ? (
          <div className="border-b border-slate-200 bg-white px-6 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                Attention Items: {totalAttention}
              </span>

              <Link
                href="/accounts?filter=ptps-due-today"
                className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                PTPs Due Today: {attention.dueTodayPtps}
              </Link>

              <Link
                href="/ptps?filter=broken"
                className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                Broken PTPs: {attention.brokenPtps}
              </Link>

              <Link
                href="/accounts?status=Callback%20Requested"
                className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
              >
                Overdue Callbacks: {attention.overdueCallbacks}
              </Link>

              <Link
                href="/accounts"
                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
              >
                Stale Accounts: {attention.staleAccounts}
              </Link>
            </div>
          </div>
        ) : null}

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}