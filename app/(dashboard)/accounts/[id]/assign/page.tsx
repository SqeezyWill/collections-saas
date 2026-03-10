'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type PageProps = {
  params: Promise<{ id: string }>;
};

type ProfileRow = {
  id: string;
  full_name: string;
  role: 'super_admin' | 'admin' | 'agent';
  company_id: string;
};

type AccountRow = {
  id: string;
  debtor_name: string;
  collector_name: string | null;
  company_id: string;
};

export default function AssignCollectorPage({ params }: PageProps) {
  const router = useRouter();

  const [accountId, setAccountId] = useState('');
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [assignmentType, setAssignmentType] = useState<'agent' | 'admin'>('agent');
  const [selectedUser, setSelectedUser] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        const resolvedParams = await params;
        const id = resolvedParams.id;
        setAccountId(id);

        if (!supabase) {
          setErrorMessage('Supabase is not configured.');
          setLoading(false);
          return;
        }

        const { data: accountData, error: accountError } = await supabase
          .from('accounts')
          .select('id, debtor_name, collector_name, company_id')
          .eq('id', id)
          .single();

        if (accountError || !accountData) {
          setErrorMessage(accountError?.message || 'Account not found.');
          setLoading(false);
          return;
        }

        setAccount(accountData as AccountRow);

        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, role, company_id')
          .eq('company_id', accountData.company_id)
          .in('role', ['agent', 'admin'])
          .order('full_name', { ascending: true });

        if (profileError) {
          setErrorMessage(profileError.message);
          setLoading(false);
          return;
        }

        setProfiles((profileData || []) as ProfileRow[]);
        setLoading(false);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Something went wrong.');
        setLoading(false);
      }
    }

    loadData();
  }, [params]);

  const filteredProfiles = useMemo(() => {
    return profiles.filter((profile) => profile.role === assignmentType);
  }, [profiles, assignmentType]);

  useEffect(() => {
    setSelectedUser('');
  }, [assignmentType]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || !accountId) {
      setErrorMessage('Supabase is not configured.');
      return;
    }

    if (!selectedUser) {
      setErrorMessage('Please select a user to assign.');
      return;
    }

    setSaving(true);
    setErrorMessage('');

    const selectedProfile = profiles.find((profile) => profile.id === selectedUser);

    if (!selectedProfile) {
      setSaving(false);
      setErrorMessage('Selected user could not be found.');
      return;
    }

    const { error } = await supabase
      .from('accounts')
      .update({ collector_name: selectedProfile.full_name })
      .eq('id', accountId);

    setSaving(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push(`/accounts/${accountId}`);
    router.refresh();
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Assign Collector</h1>
        <p className="text-slate-500">Loading account and users...</p>
      </div>
    );
  }

  if (errorMessage && !account) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Assign Collector</h1>
        <p className="text-red-600">{errorMessage}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/accounts/${accountId}`}
          className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          ← Back to Account Workspace
        </Link>
        <h1 className="text-3xl font-semibold text-slate-900">Assign Collector</h1>
        <p className="mt-1 text-slate-500">
          Assign this account to an agent or an admin manager from registered users.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Account</p>
          <p className="mt-1 font-medium text-slate-900">{account?.debtor_name}</p>
          <p className="mt-3 text-sm text-slate-500">Current Assigned User</p>
          <p className="mt-1 font-medium text-slate-900">{account?.collector_name || 'Unassigned'}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Assignment Type
            </label>
            <select
              value={assignmentType}
              onChange={(event) => setAssignmentType(event.target.value as 'agent' | 'admin')}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            >
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Assign To
            </label>
            <select
              value={selectedUser}
              onChange={(event) => setSelectedUser(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">Select a {assignmentType}</option>
              {filteredProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.full_name}
                </option>
              ))}
            </select>
          </div>

          {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href={`/accounts/${accountId}`}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Assignment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
