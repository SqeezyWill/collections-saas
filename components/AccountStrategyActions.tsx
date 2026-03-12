'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Props = {
  accountId: string;
};

type UserProfile = {
  id: string;
  role: string | null;
};

function normalizeRole(role: string | null | undefined) {
  return String(role || '').trim().toLowerCase();
}

export function AccountStrategyActions({ accountId }: Props) {
  const [role, setRole] = useState<string>('agent');
  const [loadingRole, setLoadingRole] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadRole() {
      try {
        if (!supabase) {
          if (mounted) {
            setRole('agent');
            setLoadingRole(false);
          }
          return;
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user?.id;

        if (!userId) {
          if (mounted) {
            setRole('agent');
            setLoadingRole(false);
          }
          return;
        }

        const { data } = await supabase
          .from('user_profiles')
          .select('id,role')
          .eq('id', userId)
          .maybeSingle();

        const profile = data as UserProfile | null;

        if (mounted) {
          setRole(normalizeRole(profile?.role));
          setLoadingRole(false);
        }
      } catch {
        if (mounted) {
          setRole('agent');
          setLoadingRole(false);
        }
      }
    }

    loadRole();

    return () => {
      mounted = false;
    };
  }, []);

  if (loadingRole) {
    return null;
  }

  const canManageStrategy = role === 'admin' || role === 'super_admin';

  if (!canManageStrategy) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href={`/accounts/${accountId}/strategy`}
        className="inline-flex w-fit items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Change Strategy
      </Link>
    </div>
  );
}