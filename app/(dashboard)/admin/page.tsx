'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';

type DbCompany = {
  id: string;
  name: string;
  code: string;
  themeColor: string;
  logoUrl?: string | null;
};

type AddUserFormState = {
  name: string;
  email: string;
  role: string;
  companyId: string;
  password: string;
};

type ResetPasswordState = {
  userId: string;
  email: string;
  name: string;
};

type ResetPasswordResult =
  | { email: string; recoveryLink: string | null }
  | { email: string; tempPassword: string };

type EditUserState = {
  userId: string;
  name: string;
  email: string;
  role: string;
  companyId: string;
};

type AddCompanyFormState = {
  name: string;
  code: string;
  themeColor: string;
  logoUrl: string;
};

type EditCompanyState = {
  id: string;
  name: string;
  code: string;
  themeColor: string;
  logoUrl: string;
  mode: 'edit' | 'branding';
};

type AuthProfile = {
  id: string;
  name: string | null;
  email: string | null;
  company_id: string | null;
  role: string | null;
};

const SINGLE_COMPANY_NAME = 'Pezesha';

function roleBadgeClass(role: string) {
  const normalized = String(role || '').toLowerCase();
  if (normalized.includes('super')) return 'bg-purple-100 text-purple-700';
  if (normalized.includes('admin')) return 'bg-sky-100 text-sky-700';
  if (normalized.includes('agent')) return 'bg-emerald-100 text-emerald-700';
  return 'bg-slate-100 text-slate-700';
}

function defaultUserPassword() {
  return 'credcoll@2026';
}

const BRAND_PRESET_COLORS = [
  '#0f766e',
  '#2563eb',
  '#4338ca',
  '#7c3aed',
  '#db2777',
  '#dc2626',
  '#f59e0b',
  '#16a34a',
  '#111827',
];

function normalizeRole(role: string | null | undefined) {
  return String(role || '').trim().toLowerCase();
}

export default function AdminPage() {
  const usersTableRef = useRef<HTMLDivElement | null>(null);

  const [companyFilter, setCompanyFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [search, setSearch] = useState('');

  const [dbCompanies, setDbCompanies] = useState<DbCompany[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [companiesError, setCompaniesError] = useState<string | null>(null);

  const [dbUsers, setDbUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [currentProfile, setCurrentProfile] = useState<AuthProfile | null>(null);

  const [isAddCompanyOpen, setIsAddCompanyOpen] = useState(false);
  const [addCompanySaving, setAddCompanySaving] = useState(false);
  const [addCompanyError, setAddCompanyError] = useState<string | null>(null);
  const [addCompanySuccess, setAddCompanySuccess] = useState<string | null>(null);
  const [addCompanyForm, setAddCompanyForm] = useState<AddCompanyFormState>({
    name: '',
    code: '',
    themeColor: '#2563eb',
    logoUrl: '',
  });

  const [isEditCompanyOpen, setIsEditCompanyOpen] = useState(false);
  const [editCompanySaving, setEditCompanySaving] = useState(false);
  const [editCompanyError, setEditCompanyError] = useState<string | null>(null);
  const [editCompanySuccess, setEditCompanySuccess] = useState<string | null>(null);
  const [editCompanyState, setEditCompanyState] = useState<EditCompanyState>({
    id: '',
    name: '',
    code: '',
    themeColor: '#2563eb',
    logoUrl: '',
    mode: 'edit',
  });

  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [addUserSaving, setAddUserSaving] = useState(false);
  const [addUserError, setAddUserError] = useState<string | null>(null);
  const [addUserSuccess, setAddUserSuccess] = useState<string | null>(null);

  const [addUserForm, setAddUserForm] = useState<AddUserFormState>({
    name: '',
    email: '',
    role: 'agent',
    companyId: '',
    password: '',
  });

  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetSaving, setResetSaving] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetState, setResetState] = useState<ResetPasswordState>({
    userId: '',
    email: '',
    name: '',
  });
  const [resetResult, setResetResult] = useState<ResetPasswordResult | null>(null);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditUserState>({
    userId: '',
    name: '',
    email: '',
    role: 'agent',
    companyId: '',
  });

  async function authHeaders(includeJson = false): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};

    if (includeJson) {
      headers['Content-Type'] = 'application/json';
    }

    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    return headers;
  }

  function matchesCompany(userCompanyId: any, company: DbCompany) {
    const v = String(userCompanyId || '').trim().toLowerCase();
    const id = String(company.id || '').trim().toLowerCase();
    const code = String(company.code || '').trim().toLowerCase();
    const name = String(company.name || '').trim().toLowerCase();

    if (!v) return false;
    if (v === id) return true;
    if (code && v === code) return true;

    if (name) {
      const simplifiedName = name.replace(/[^a-z0-9]+/g, ' ').trim();
      const simplifiedV = v.replace(/[^a-z0-9]+/g, ' ').trim();

      if (simplifiedName.includes(simplifiedV) || simplifiedV.includes(simplifiedName)) {
        return true;
      }

      const words = simplifiedName.split(' ').filter(Boolean);
      if (words.includes(simplifiedV)) return true;
    }

    return false;
  }

  function getSingleCompany() {
    return (
      dbCompanies.find((c) => String(c.name || '').trim().toLowerCase() === SINGLE_COMPANY_NAME.toLowerCase()) ||
      dbCompanies.find((c) => String(c.code || '').trim().toLowerCase() === SINGLE_COMPANY_NAME.toLowerCase()) ||
      dbCompanies[0] ||
      null
    );
  }

  function getCompanyName(companyId: string) {
    const fixedCompany = getSingleCompany();
    if (fixedCompany) return fixedCompany.name;
    const company = dbCompanies.find((c) => matchesCompany(companyId, c));
    return company?.name || SINGLE_COMPANY_NAME;
  }

  async function readJsonSafe(res: Response) {
    const text = await res.text();
    if (!text) return { json: null as any, text: '' };

    try {
      return { json: JSON.parse(text), text };
    } catch {
      return { json: null as any, text };
    }
  }

  async function refreshCompanies() {
    setLoadingCompanies(true);
    setCompaniesError(null);

    try {
      const res = await fetch('/api/admin/companies', {
        headers: await authHeaders(),
        cache: 'no-store',
      });

      const { json, text } = await readJsonSafe(res);

      if (!res.ok) {
        const msg =
          json?.error ||
          (text ? text.slice(0, 180) : `Request failed (${res.status}) with empty body`);
        throw new Error(msg);
      }

      const list: DbCompany[] = (json?.companies ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        themeColor: c.themeColor || '#2563eb',
        logoUrl: c.logoUrl ?? null,
      }));

      setDbCompanies(list);

      const singleCompany = (
        list.find((c) => String(c.name || '').trim().toLowerCase() === SINGLE_COMPANY_NAME.toLowerCase()) ||
        list[0] ||
        null
      );

      setAddUserForm((prev) => ({
        ...prev,
        companyId: singleCompany?.id || '',
      }));

      setEditState((prev) => ({
        ...prev,
        companyId: singleCompany?.id || '',
      }));

      setCompanyFilter('');
    } catch (e: any) {
      setCompaniesError(e?.message || 'Failed to load companies');
    } finally {
      setLoadingCompanies(false);
    }
  }

  async function refreshUsers() {
    setLoadingUsers(true);
    setUsersError(null);

    try {
      const res = await fetch('/api/admin/users', {
        headers: await authHeaders(),
        cache: 'no-store',
      });

      const { json, text } = await readJsonSafe(res);

      if (!res.ok) {
        const msg =
          json?.error ||
          (text ? text.slice(0, 180) : `Request failed (${res.status}) with empty body`);
        throw new Error(msg);
      }

      setDbUsers(json?.users ?? []);
    } catch (e: any) {
      setUsersError(e?.message || 'Failed to load users');
    } finally {
      setLoadingUsers(false);
    }
  }

  async function refreshCurrentProfile() {
    if (!supabase) return;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const userId = session?.user?.id;
      if (!userId) {
        setCurrentProfile(null);
        return;
      }

      const { data, error } = await supabase
        .from('user_profiles')
        .select('id,name,email,company_id,role')
        .eq('id', userId)
        .maybeSingle();

      if (error || !data) {
        setCurrentProfile(null);
        return;
      }

      setCurrentProfile(data as AuthProfile);
    } catch {
      setCurrentProfile(null);
    }
  }

  useEffect(() => {
    refreshCompanies();
    refreshUsers();
    refreshCurrentProfile();
  }, []);

  const canCreateUsers = normalizeRole(currentProfile?.role) === 'super_admin';

  const companyRows = useMemo(() => {
    return dbCompanies.map((company) => {
      const companyUsers = dbUsers.filter((user) => matchesCompany(user.companyId, company));

      const superAdmins = companyUsers.filter((user) =>
        String(user.role).toLowerCase().includes('super')
      ).length;

      const admins = companyUsers.filter((user) =>
        String(user.role).toLowerCase().includes('admin')
      ).length;

      const agents = companyUsers.filter((user) =>
        String(user.role).toLowerCase().includes('agent')
      ).length;

      return { ...company, usersCount: companyUsers.length, superAdmins, admins, agents };
    });
  }, [dbCompanies, dbUsers]);

  const filteredUsers = useMemo(() => {
    return dbUsers.filter((user) => {
      const matchesRole =
        !roleFilter || String(user.role).toLowerCase() === String(roleFilter).toLowerCase();

      const safeSearch = search.trim().toLowerCase();
      const matchesSearch =
        !safeSearch ||
        String(user.name || '').toLowerCase().includes(safeSearch) ||
        String(user.email || '').toLowerCase().includes(safeSearch) ||
        String(user.role || '').toLowerCase().includes(safeSearch) ||
        SINGLE_COMPANY_NAME.toLowerCase().includes(safeSearch);

      return matchesRole && matchesSearch;
    });
  }, [roleFilter, search, dbUsers]);

  const totalCompanies = 1;
  const totalUsers = dbUsers.length;
  const totalAdmins = dbUsers.filter((u) => String(u.role).toLowerCase().includes('admin')).length;
  const totalAgents = dbUsers.filter((u) => String(u.role).toLowerCase().includes('agent')).length;

  const uniqueRoles = Array.from(new Set(dbUsers.map((u) => String(u.role || '')).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));

  function openAddCompany() {
    setAddCompanySuccess(null);
    setAddCompanyError(null);
    setAddCompanyForm({
      name: '',
      code: '',
      themeColor: '#2563eb',
      logoUrl: '',
    });
    setIsAddCompanyOpen(true);
  }

  function closeAddCompany() {
    if (addCompanySaving) return;
    setIsAddCompanyOpen(false);
  }

  async function submitAddCompany(e: React.FormEvent) {
    e.preventDefault();
    setAddCompanyError(null);
    setAddCompanySuccess(null);

    const payload = {
      name: addCompanyForm.name.trim(),
      code: addCompanyForm.code.trim().toUpperCase(),
      themeColor: addCompanyForm.themeColor.trim() || '#2563eb',
      logoUrl: addCompanyForm.logoUrl.trim() || null,
    };

    if (!payload.name || !payload.code) {
      setAddCompanyError('Please fill company name and code.');
      return;
    }

    setAddCompanySaving(true);
    try {
      const res = await fetch('/api/admin/companies', {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify(payload),
      });

      const { json, text } = await readJsonSafe(res);
      if (!res.ok) {
        const msg = json?.error || (text ? text.slice(0, 180) : 'Failed to create company');
        throw new Error(msg);
      }

      setAddCompanySuccess(`Company created: ${json?.company?.name || payload.name}`);
      await refreshCompanies();
      setIsAddCompanyOpen(false);
    } catch (err: any) {
      setAddCompanyError(err?.message || 'Failed to create company');
    } finally {
      setAddCompanySaving(false);
    }
  }

  function openEditCompany(company: any, mode: 'edit' | 'branding') {
    setEditCompanySuccess(null);
    setEditCompanyError(null);

    setEditCompanyState({
      id: String(company.id),
      name: String(company.name || ''),
      code: String(company.code || ''),
      themeColor: String(company.themeColor || '#2563eb'),
      logoUrl: String(company.logoUrl || ''),
      mode,
    });

    setIsEditCompanyOpen(true);
  }

  function closeEditCompany() {
    if (editCompanySaving) return;
    setIsEditCompanyOpen(false);
  }

  async function submitEditCompany(e: React.FormEvent) {
    e.preventDefault();
    setEditCompanyError(null);
    setEditCompanySuccess(null);

    if (!editCompanyState.id) {
      setEditCompanyError('Missing company id.');
      return;
    }

    const payload =
      editCompanyState.mode === 'branding'
        ? {
            themeColor: editCompanyState.themeColor.trim() || '#2563eb',
            logoUrl: editCompanyState.logoUrl.trim() || null,
          }
        : {
            name: editCompanyState.name.trim(),
            code: editCompanyState.code.trim().toUpperCase(),
            themeColor: editCompanyState.themeColor.trim() || '#2563eb',
            logoUrl: editCompanyState.logoUrl.trim() || null,
          };

    if (editCompanyState.mode === 'edit') {
      if (!(payload as any).name || !(payload as any).code) {
        setEditCompanyError('Please fill company name and code.');
        return;
      }
    }

    setEditCompanySaving(true);
    try {
      const res = await fetch(`/api/admin/companies/${encodeURIComponent(editCompanyState.id)}`, {
        method: 'PATCH',
        headers: await authHeaders(true),
        body: JSON.stringify(payload),
      });

      const { json, text } = await readJsonSafe(res);
      if (!res.ok) {
        const msg = json?.error || (text ? text.slice(0, 180) : 'Failed to update company');
        throw new Error(msg);
      }

      setEditCompanySuccess(
        editCompanyState.mode === 'branding'
          ? `Branding updated for ${json?.company?.name || editCompanyState.name}`
          : `Company updated: ${json?.company?.name || editCompanyState.name}`
      );

      await refreshCompanies();
      setIsEditCompanyOpen(false);
    } catch (err: any) {
      setEditCompanyError(err?.message || 'Failed to update company');
    } finally {
      setEditCompanySaving(false);
    }
  }

  function manageUsersForCompany(company: any) {
    const id = String(company.id || '').trim();
    if (!id) return;

    setSearch('');
    setRoleFilter('');
    setCompanyFilter('');

    requestAnimationFrame(() => {
      usersTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        usersTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    });
  }

  function openAddUser() {
    if (!canCreateUsers) return;

    setAddUserSuccess(null);
    setAddUserError(null);

    const singleCompanyId = getSingleCompany()?.id || '';

    setAddUserForm((prev) => ({
      ...prev,
      name: '',
      email: '',
      password: defaultUserPassword(),
      role: prev.role || 'agent',
      companyId: singleCompanyId,
    }));

    setIsAddUserOpen(true);
  }

  function closeAddUser() {
    if (addUserSaving) return;
    setIsAddUserOpen(false);
  }

  async function submitAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddUserError(null);
    setAddUserSuccess(null);

    const singleCompanyId = getSingleCompany()?.id || addUserForm.companyId;

    const payload = {
      name: addUserForm.name.trim(),
      email: addUserForm.email.trim().toLowerCase(),
      role: addUserForm.role,
      companyId: singleCompanyId,
      password: addUserForm.password,
    };

    if (!canCreateUsers) {
      setAddUserError('Only super_admin can create users.');
      return;
    }

    if (!payload.name || !payload.email || !payload.role || !payload.companyId || !payload.password) {
      setAddUserError('Please fill name, email, role, and a temporary password.');
      return;
    }

    setAddUserSaving(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify(payload),
      });

      const { json, text } = await readJsonSafe(res);
      if (!res.ok) {
        const msg = json?.error || (text ? text.slice(0, 180) : 'Failed to create user');
        throw new Error(msg);
      }

      setAddUserSuccess(`User created: ${json?.user?.email || payload.email}`);
      await refreshUsers();
      setIsAddUserOpen(false);
    } catch (err: any) {
      setAddUserError(err?.message || 'Failed to create user');
    } finally {
      setAddUserSaving(false);
    }
  }

  function openResetPassword(user: any) {
    setResetSuccess(null);
    setResetError(null);
    setResetResult(null);
    setResetState({
      userId: String(user.id || ''),
      email: String(user.email || ''),
      name: String(user.name || ''),
    });
    setIsResetOpen(true);
  }

  function closeResetPassword() {
    if (resetSaving) return;
    setIsResetOpen(false);
  }

  async function submitResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetError(null);
    setResetSuccess(null);
    setResetResult(null);

    const userId = resetState.userId;
    if (!userId) {
      setResetError('Missing user id.');
      return;
    }

    setResetSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({}),
      });

      const { json, text } = await readJsonSafe(res);
      if (!res.ok) {
        const msg = json?.error || (text ? text.slice(0, 180) : 'Failed to reset password');
        throw new Error(msg);
      }

      setResetResult(json as ResetPasswordResult);

      if (json && 'recoveryLink' in json) {
        setResetSuccess(`Recovery link generated for ${json.email}.`);
      } else if (json && 'tempPassword' in json) {
        setResetSuccess(`Temporary password generated for ${json.email}.`);
      } else {
        setResetSuccess('Password reset generated.');
      }
    } catch (err: any) {
      setResetError(err?.message || 'Failed to reset password');
    } finally {
      setResetSaving(false);
    }
  }

  async function copyToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore
    }
  }

  function openEditUser(user: any) {
    setEditSuccess(null);
    setEditError(null);

    const singleCompanyId = getSingleCompany()?.id || '';

    setEditState({
      userId: String(user.id || ''),
      name: String(user.name || ''),
      email: String(user.email || ''),
      role: String(user.role || 'agent'),
      companyId: String(singleCompanyId || user.companyId || ''),
    });

    setIsEditOpen(true);
  }

  function closeEditUser() {
    if (editSaving) return;
    setIsEditOpen(false);
  }

  async function submitEditUser(e: React.FormEvent) {
    e.preventDefault();
    setEditError(null);
    setEditSuccess(null);

    const payload = {
      name: editState.name.trim(),
      role: editState.role,
      companyId: getSingleCompany()?.id || editState.companyId,
    };

    if (!editState.userId || !payload.name || !payload.role || !payload.companyId) {
      setEditError('Please fill name and role.');
      return;
    }

    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(editState.userId)}`, {
        method: 'PATCH',
        headers: await authHeaders(true),
        body: JSON.stringify(payload),
      });

      const { json, text } = await readJsonSafe(res);
      if (!res.ok) {
        const msg = json?.error || (text ? text.slice(0, 180) : 'Failed to update user');
        throw new Error(msg);
      }

      setEditSuccess(`User updated: ${editState.email || payload.name}`);
      await refreshUsers();
      setIsEditOpen(false);
    } catch (err: any) {
      setEditError(err?.message || 'Failed to update user');
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {isAddCompanyOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAddCompany();
          }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Add Company</h3>
                <p className="mt-1 text-sm text-slate-500">Create a new tenant.</p>
              </div>

              <button
                type="button"
                onClick={closeAddCompany}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                disabled={addCompanySaving}
              >
                Close
              </button>
            </div>

            <form onSubmit={submitAddCompany} className="space-y-4 p-5">
              {addCompanyError ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {addCompanyError}
                </p>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Company name</label>
                  <input
                    value={addCompanyForm.name}
                    onChange={(e) => setAddCompanyForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="e.g. Acorn BPO"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Code</label>
                  <input
                    value={addCompanyForm.code}
                    onChange={(e) => setAddCompanyForm((p) => ({ ...p, code: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="e.g. ACN"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Theme color</label>
                  <input
                    value={addCompanyForm.themeColor}
                    onChange={(e) => setAddCompanyForm((p) => ({ ...p, themeColor: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="#2563eb"
                  />
                </div>

                <div className="md:col-span-2 flex flex-wrap gap-2 pt-1">
                  {BRAND_PRESET_COLORS.map((c) => {
                    const active = String(addCompanyForm.themeColor || '').toLowerCase() === c.toLowerCase();
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setAddCompanyForm((p) => ({ ...p, themeColor: c }))}
                        className={`h-9 w-9 rounded-full border ${active ? 'border-slate-900 ring-2 ring-slate-400' : 'border-slate-200'}`}
                        style={{ backgroundColor: c }}
                        title={c}
                        aria-label={`Pick ${c}`}
                      />
                    );
                  })}
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Logo URL (optional)</label>
                  <input
                    value={addCompanyForm.logoUrl}
                    onChange={(e) => setAddCompanyForm((p) => ({ ...p, logoUrl: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="https://..."
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={closeAddCompany}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  disabled={addCompanySaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  disabled={addCompanySaving}
                >
                  {addCompanySaving ? 'Creating…' : 'Create company'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isEditCompanyOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeEditCompany();
          }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {editCompanyState.mode === 'branding' ? 'Branding Setup' : 'Edit Tenant'}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {editCompanyState.mode === 'branding' ? 'Update logo and theme.' : 'Update tenant profile details.'}
                </p>
              </div>

              <button
                type="button"
                onClick={closeEditCompany}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                disabled={editCompanySaving}
              >
                Close
              </button>
            </div>

            <form onSubmit={submitEditCompany} className="space-y-4 p-5">
              {editCompanyError ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {editCompanyError}
                </p>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                {editCompanyState.mode === 'edit' ? (
                  <>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium text-slate-700">Company name</label>
                      <input
                        value={editCompanyState.name}
                        onChange={(e) => setEditCompanyState((p) => ({ ...p, name: e.target.value }))}
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                        placeholder="Company name"
                        autoFocus
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Code</label>
                      <input
                        value={editCompanyState.code}
                        onChange={(e) => setEditCompanyState((p) => ({ ...p, code: e.target.value }))}
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                        placeholder="CRG"
                      />
                    </div>
                  </>
                ) : null}

                <div className={editCompanyState.mode === 'branding' ? 'md:col-span-2' : ''}>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Theme color</label>
                  <input
                    value={editCompanyState.themeColor}
                    onChange={(e) => setEditCompanyState((p) => ({ ...p, themeColor: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="#2563eb"
                  />
                </div>

                <div className="md:col-span-2 flex flex-wrap gap-2 pt-1">
                  {BRAND_PRESET_COLORS.map((c) => {
                    const active = String(editCompanyState.themeColor || '').toLowerCase() === c.toLowerCase();
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEditCompanyState((p) => ({ ...p, themeColor: c }))}
                        className={`h-9 w-9 rounded-full border ${active ? 'border-slate-900 ring-2 ring-slate-400' : 'border-slate-200'}`}
                        style={{ backgroundColor: c }}
                        title={c}
                        aria-label={`Pick ${c}`}
                      />
                    );
                  })}
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Logo URL (optional)</label>
                  <input
                    value={editCompanyState.logoUrl}
                    onChange={(e) => setEditCompanyState((p) => ({ ...p, logoUrl: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="https://..."
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={closeEditCompany}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  disabled={editCompanySaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  disabled={editCompanySaving}
                >
                  {editCompanySaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isEditOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeEditUser();
          }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Edit User</h3>
                <p className="mt-1 text-sm text-slate-500">Update user profile details. Email is read-only.</p>
              </div>

              <button
                type="button"
                onClick={closeEditUser}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                disabled={editSaving}
              >
                Close
              </button>
            </div>

            <form onSubmit={submitEditUser} className="space-y-4 p-5">
              {editError ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{editError}</p>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Full name</label>
                  <input
                    value={editState.name}
                    onChange={(e) => setEditState((p) => ({ ...p, name: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="e.g. Jane Doe"
                    autoFocus
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                  <input
                    value={editState.email}
                    readOnly
                    className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Role</label>
                  <select
                    value={editState.role}
                    onChange={(e) => setEditState((p) => ({ ...p, role: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="agent">agent</option>
                    <option value="admin">admin</option>
                    <option value="super_admin">super_admin</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={closeEditUser}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  disabled={editSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  disabled={editSaving}
                >
                  {editSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isResetOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeResetPassword();
          }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Reset Password</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Generate a recovery link (preferred) or a temporary password (fallback) for{' '}
                  <span className="font-medium text-slate-700">{resetState.name || resetState.email || 'this user'}</span>.
                </p>
              </div>

              <button
                type="button"
                onClick={closeResetPassword}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                disabled={resetSaving}
              >
                Close
              </button>
            </div>

            <form onSubmit={submitResetPassword} className="space-y-4 p-5">
              {resetError ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{resetError}</p>
              ) : null}

              {resetResult ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  {'recoveryLink' in resetResult ? (
                    <>
                      <p className="text-sm font-medium text-slate-800">Recovery link</p>
                      <p className="mt-1 break-all text-xs text-slate-600">{resetResult.recoveryLink || '(No link returned)'}</p>
                      {resetResult.recoveryLink ? (
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(resetResult.recoveryLink || '')}
                            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Copy link
                          </button>
                          <a
                            href={resetResult.recoveryLink}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                          >
                            Open link
                          </a>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-slate-800">Temporary password</p>
                      <p className="mt-1 break-all text-sm text-slate-700">{resetResult.tempPassword}</p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => copyToClipboard(resetResult.tempPassword)}
                          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Copy password
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  Click <span className="font-medium">Generate</span> to produce the reset method for this user.
                </p>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={closeResetPassword}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  disabled={resetSaving}
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  disabled={resetSaving}
                >
                  {resetSaving ? 'Generating…' : 'Generate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isAddUserOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAddUser();
          }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Add User</h3>
                <p className="mt-1 text-sm text-slate-500">Create a new user and set a temporary password.</p>
              </div>

              <button
                type="button"
                onClick={closeAddUser}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                disabled={addUserSaving}
              >
                Close
              </button>
            </div>

            <form onSubmit={submitAddUser} className="space-y-4 p-5">
              {addUserError ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{addUserError}</p>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Full name</label>
                  <input
                    value={addUserForm.name}
                    onChange={(e) => setAddUserForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="e.g. Jane Doe"
                    autoFocus
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
                  <input
                    type="email"
                    value={addUserForm.email}
                    onChange={(e) => setAddUserForm((p) => ({ ...p, email: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="e.g. jane@company.com"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Role</label>
                  <select
                    value={addUserForm.role}
                    onChange={(e) => setAddUserForm((p) => ({ ...p, role: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="agent">agent</option>
                    <option value="admin">admin</option>
                    <option value="super_admin">super_admin</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Company</label>
                  <input
                    value={SINGLE_COMPANY_NAME}
                    readOnly
                    className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Temporary password</label>
                  <div className="flex gap-2">
                    <input
                      value={addUserForm.password}
                      onChange={(e) => setAddUserForm((p) => ({ ...p, password: e.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      placeholder="Set a temporary password"
                    />
                    <button
                      type="button"
                      onClick={() => setAddUserForm((p) => ({ ...p, password: defaultUserPassword() }))}
                      className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Use Default
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Default password is <span className="font-medium">credcoll@2026</span>. Share this with the user and ask them to change it after first login.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={closeAddUser}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  disabled={addUserSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  disabled={addUserSaving}
                >
                  {addUserSaving ? 'Creating…' : 'Create user'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Admin Setup</h1>
          <p className="mt-1 text-slate-500">Manage users and roles for the Pezesha workspace.</p>
        </div>

        <div className="flex flex-wrap gap-3">
          {canCreateUsers ? (
            <button
              type="button"
              onClick={openAddUser}
              className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
            >
              Add User
            </button>
          ) : null}
        </div>
      </div>

      {addCompanySuccess ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{addCompanySuccess}</p>
      ) : null}
      {editCompanySuccess ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{editCompanySuccess}</p>
      ) : null}
      {addUserSuccess ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{addUserSuccess}</p>
      ) : null}
      {resetSuccess ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{resetSuccess}</p>
      ) : null}
      {editSuccess ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{editSuccess}</p>
      ) : null}

      {companiesError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{companiesError}</p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Active Company</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{SINGLE_COMPANY_NAME}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total Users</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totalUsers}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Admin Users</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totalAdmins}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Agent Users</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totalAgents}</p>
        </div>
      </div>

      <div ref={usersTableRef} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="section-title">Users & Roles</h2>
            <p className="mt-1 text-sm text-slate-500">Search and review role assignments for Pezesha.</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, role..."
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />

            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">All Roles</option>
              {uniqueRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
        </div>

        {usersError ? (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{usersError}</p>
        ) : null}
        {loadingUsers ? <p className="mb-3 text-sm text-slate-500">Loading users…</p> : null}

        <DataTable headers={['Name', 'Email', 'Role', 'Company', 'Actions']}>
          {filteredUsers.map((user) => (
            <tr key={user.id}>
              <td className="px-4 py-3 font-medium text-slate-900">{user.name}</td>
              <td className="px-4 py-3 text-slate-700">{user.email}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${roleBadgeClass(user.role)}`}>
                  {user.role}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-700">{SINGLE_COMPANY_NAME}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openEditUser(user)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => openResetPassword(user)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Reset Password
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Showing {filteredUsers.length} of {dbUsers.length} users</p>

          <button
            type="button"
            onClick={() => {
              setSearch('');
              setCompanyFilter('');
              setRoleFilter('');
            }}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Reset Filters
          </button>
        </div>
      </div>
    </div>
  );
}