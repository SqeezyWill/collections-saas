'use client';

import { Bell, Building2, Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { getCompany } from '@/lib/selectors';
import { supabase } from '@/lib/supabase';

type SearchResult = {
  id: string;
  cfid: string | null;
  debtor_name: string | null;
  account_no: string | null;
  primary_phone: string | null;
  contacts: string | null;
};

type AuthProfile = {
  id: string;
  name: string | null;
  email: string | null;
  company_id: string | null;
  role: string | null;
};

type SearchField =
  | 'cfid'
  | 'phone'
  | 'account_no'
  | 'debtor_name'
  | 'identification'
  | 'customer_id';

const SEARCH_OPTIONS: Array<{ value: SearchField; label: string }> = [
  { value: 'cfid', label: 'CFID' },
  { value: 'phone', label: 'PHONE' },
  { value: 'account_no', label: 'ACCOUNT NUMBER' },
  { value: 'debtor_name', label: 'DEBTOR NAME' },
  { value: 'identification', label: 'IDENTIFICATION' },
  { value: 'customer_id', label: 'CUSTOMER ID' },
];

const TOGGLE_EVENT = 'app:toggle-sidebar';

export function Topbar() {
  const router = useRouter();

  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const company = getCompany(profile?.company_id || '');

  const [query, setQuery] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('cfid');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = query.trim();

    if (!trimmed) {
      router.push('/accounts');
      return;
    }

    const params = new URLSearchParams();
    params.set('search', trimmed);
    params.set('searchField', searchField);

    setShowDropdown(false);
    router.push(`/accounts?${params.toString()}`);
  }

  function handleToggleSidebar() {
    window.dispatchEvent(new Event(TOGGLE_EVENT));
  }

  useEffect(() => {
    if (!supabase) return;

    const client = supabase;

    async function loadProfile() {
      const { data: sessionData } = await client.auth.getSession();
      const userId = sessionData.session?.user?.id;

      if (!userId) {
        setProfile(null);
        return;
      }

      const { data, error } = await client
        .from('user_profiles')
        .select('id,name,email,company_id,role')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Failed to load profile in Topbar:', error);
        setProfile(null);
        return;
      }

      setProfile((data as AuthProfile) || null);
    }

    loadProfile();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange(async (_event, session) => {
      const userId = session?.user?.id;

      if (!userId) {
        setProfile(null);
        return;
      }

      const { data, error } = await client
        .from('user_profiles')
        .select('id,name,email,company_id,role')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Failed to refresh profile in Topbar:', error);
        setProfile(null);
        return;
      }

      setProfile((data as AuthProfile) || null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase) {
      setResults([]);
      setLoading(false);
      return;
    }

    const client = supabase!;

    async function runSearch() {
      const trimmed = query.trim();

      if (trimmed.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }

      if (!profile?.company_id) {
        setResults([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        const client = supabase;
        const {
          data: { session },
        } = await client.auth.getSession();

        const token = session?.access_token;
        if (!token) {
          setResults([]);
          return;
        }

        const params = new URLSearchParams();
        params.set('q', trimmed);
        params.set('field', searchField);

        const res = await fetch(`/api/accounts/search?${params.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        });

        const payload = await res.json().catch(() => null);

        if (!res.ok) {
          console.error('Topbar search failed:', res.status, payload);
          setResults([]);
          return;
        }

        const items = payload?.results || [];
        setResults(Array.isArray(items) ? items : []);
        setShowDropdown(true);
      } catch (error) {
        console.error('Topbar search error:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }

    const timeout = setTimeout(() => {
      runSearch();
    }, 250);

    return () => clearTimeout(timeout);
  }, [query, searchField, profile?.company_id]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleToggleSidebar}
          className="hidden rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:inline-flex"
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
        >
          <Menu size={18} />
        </button>

        <div>
          <p className="text-sm text-slate-500">Current tenant</p>
          <div className="mt-1 flex items-center gap-2 text-slate-900">
            <Building2 size={18} />
            <span className="font-semibold">{company?.name || 'Unknown company'}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div ref={wrapperRef} className="relative hidden md:block">
          <form
            onSubmit={handleSearch}
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2"
          >
            <select
              value={searchField}
              onChange={(event) => setSearchField(event.target.value as SearchField)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 outline-none"
            >
              {SEARCH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <Search size={16} className="text-slate-400" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => {
                if (results.length > 0) setShowDropdown(true);
              }}
              placeholder="Search selected field..."
              className="w-72 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </form>

          {showDropdown && query.trim().length >= 2 ? (
            <div className="absolute right-0 z-50 mt-2 w-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
              <div className="border-b border-slate-100 px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                Search Results
              </div>

              {loading ? (
                <div className="px-4 py-4 text-sm text-slate-500">Searching...</div>
              ) : results.length > 0 ? (
                <div className="max-h-96 overflow-y-auto">
                  {results.map((result) => (
                    <Link
                      key={result.id}
                      href={`/accounts/${result.id}`}
                      onClick={() => setShowDropdown(false)}
                      className="block border-b border-slate-100 px-4 py-3 hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-slate-900">
                          {result.debtor_name || 'Unnamed Account'}
                        </p>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                          {result.cfid || 'No CFID'}
                        </span>
                      </div>

                      <div className="mt-1 space-y-1 text-sm text-slate-500">
                        <p>Account: {result.account_no || '-'}</p>
                        <p>Phone: {result.primary_phone || result.contacts || '-'}</p>
                      </div>
                    </Link>
                  ))}

                  <button
                    type="button"
                    onClick={() => {
                      const trimmed = query.trim();
                      const params = new URLSearchParams();
                      params.set('search', trimmed);
                      params.set('searchField', searchField);
                      setShowDropdown(false);
                      router.push(`/accounts?${params.toString()}`);
                    }}
                    className="w-full bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    View all results
                  </button>
                </div>
              ) : (
                <div className="px-4 py-4 text-sm text-slate-500">
                  No matching accounts found.
                </div>
              )}
            </div>
          ) : null}
        </div>

        <button className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50">
          <Bell size={18} />
        </button>

        <div className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
          {profile?.name || profile?.email || 'User'}
        </div>
      </div>
    </header>
  );
}