'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type StrategyRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
  products?: Array<{
    id: string;
    code: string;
    name: string;
    category: string | null;
    is_active?: boolean;
    sort_order?: number;
  }>;
  product_codes?: string[];
  product_ids?: string[];
};

type ProductRow = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  is_active: boolean;
  sort_order: number | null;
};

type CreateStrategyForm = {
  name: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
};

type AuthProfile = {
  id: string;
  name: string | null;
  role: string | null;
  company_id: string | null;
};

type CachedStrategiesState = {
  profile: AuthProfile | null;
  strategies: StrategyRow[];
  products: ProductRow[];
  productCode: string;
  mappingProductId: string;
  mappingSelection: string[];
  role: string;
  savedAt: number;
};

const STRATEGIES_CACHE_PREFIX = 'strategies-page-cache:v1:';
const STRATEGIES_LAST_VISIBLE_CACHE_KEY = 'strategies-page-cache:v1:last-visible';
const PEZESHA_FALLBACK_NAME = 'Pezesha';

async function readJsonSafe(res: Response) {
  const text = await res.text();
  if (!text) return { json: null as any, text: '' };
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null as any, text };
  }
}

function normalizeRole(role: string | null | undefined) {
  return String(role || '').trim().toLowerCase();
}

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function buildStrategiesCacheKey(profile: AuthProfile | null, role: string) {
  const companyId = normalizeText(profile?.company_id) || 'pending-company';
  const normalizedRole = normalizeRole(role || profile?.role);
  const name = normalizeText(profile?.name) || 'unknown-user';
  return `${STRATEGIES_CACHE_PREFIX}${companyId}:${normalizedRole}:${name}`;
}

export default function StrategiesPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const [restoredFromCache, setRestoredFromCache] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productCode, setProductCode] = useState<string>('');

  const [mappingProductId, setMappingProductId] = useState<string>('');
  const [mappingSelection, setMappingSelection] = useState<string[]>([]);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingMessage, setMappingMessage] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [mappingLoading, setMappingLoading] = useState(false);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<CreateStrategyForm>({
    name: '',
    description: '',
    sortOrder: '0',
    isActive: true,
  });

  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [role, setRole] = useState('agent');
  const [profile, setProfile] = useState<AuthProfile | null>(null);

  const strategiesCacheKey = useMemo(
    () => buildStrategiesCacheKey(profile, role),
    [profile, role]
  );

  async function authHeaders(includeJson = false): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};

    if (includeJson) {
      headers['Content-Type'] = 'application/json';
    }

    if (supabase) {
      const firstSessionResult = await supabase.auth.getSession();
      let session = firstSessionResult.data.session;
      let sessionError = firstSessionResult.error;

      if (!session && !sessionError) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        const secondSessionResult = await supabase.auth.getSession();
        session = secondSessionResult.data.session;
        sessionError = secondSessionResult.error;
      }

      if (!sessionError) {
        const token = session?.access_token;
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      }
    }

    return headers;
  }

  const activeProducts = useMemo(() => {
    return products
      .filter((p) => p.is_active !== false)
      .slice()
      .sort(
        (a, b) =>
          (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)) || a.name.localeCompare(b.name)
      );
  }, [products]);

  const sortedStrategies = useMemo(() => {
    const arr = [...strategies];
    arr.sort((a, b) => {
      const sa = typeof a.sort_order === 'number' ? a.sort_order : Number.POSITIVE_INFINITY;
      const sb = typeof b.sort_order === 'number' ? b.sort_order : Number.POSITIVE_INFINITY;
      if (sa !== sb) return sa - sb;

      const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
      const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return cb - ca;
    });
    return arr;
  }, [strategies]);

  const mappingStrategies = useMemo(() => {
    return [...sortedStrategies];
  }, [sortedStrategies]);

  const canManageStrategies = role === 'admin' || role === 'super_admin';

  function toggleSelectedProduct(id: string) {
    setSelectedProductIds((prev) => {
      const has = prev.includes(id);
      if (has) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  }

  function toggleMappingStrategy(id: string) {
    setMappingSelection((prev) => {
      const has = prev.includes(id);
      if (has) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  }

  useEffect(() => {
    try {
      const specificRaw = sessionStorage.getItem(strategiesCacheKey);
      const fallbackRaw = sessionStorage.getItem(STRATEGIES_LAST_VISIBLE_CACHE_KEY);
      const raw = specificRaw || fallbackRaw;

      if (!raw) {
        setCacheHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw) as CachedStrategiesState;

      if (parsed?.profile) setProfile(parsed.profile);
      if (Array.isArray(parsed?.strategies)) setStrategies(parsed.strategies);
      if (Array.isArray(parsed?.products)) setProducts(parsed.products);
      if (typeof parsed?.productCode === 'string') setProductCode(parsed.productCode);
      if (typeof parsed?.mappingProductId === 'string') setMappingProductId(parsed.mappingProductId);
      if (Array.isArray(parsed?.mappingSelection)) setMappingSelection(parsed.mappingSelection);
      if (typeof parsed?.role === 'string') setRole(parsed.role);

      if (
        parsed?.profile ||
        Array.isArray(parsed?.strategies) ||
        Array.isArray(parsed?.products)
      ) {
        setRestoredFromCache(true);
        setLoading(false);
        setProductsLoading(false);
      }
    } catch {
      // ignore cache read errors
    } finally {
      setCacheHydrated(true);
    }
  }, [strategiesCacheKey]);

  useEffect(() => {
    if (!cacheHydrated) return;
    if (!profile && strategies.length === 0 && products.length === 0) return;

    try {
      const payload: CachedStrategiesState = {
        profile,
        strategies,
        products,
        productCode,
        mappingProductId,
        mappingSelection,
        role,
        savedAt: Date.now(),
      };

      const serialized = JSON.stringify(payload);
      sessionStorage.setItem(strategiesCacheKey, serialized);
      sessionStorage.setItem(STRATEGIES_LAST_VISIBLE_CACHE_KEY, serialized);
    } catch {
      // ignore cache write errors
    }
  }, [
    cacheHydrated,
    strategiesCacheKey,
    profile,
    strategies,
    products,
    productCode,
    mappingProductId,
    mappingSelection,
    role,
  ]);

  async function loadProfile() {
    if (!supabase) {
      return {
        ok: false as const,
        error: 'Supabase is not configured.',
      };
    }

    const firstSessionResult = await supabase.auth.getSession();
    let session = firstSessionResult.data.session;
    let sessionError = firstSessionResult.error;

    if (!session && !sessionError) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      const secondSessionResult = await supabase.auth.getSession();
      session = secondSessionResult.data.session;
      sessionError = secondSessionResult.error;
    }

    if (sessionError) {
      return {
        ok: false as const,
        error: sessionError.message || 'Unable to load user session.',
      };
    }

    const userId = session?.user?.id;
    if (!userId) {
      return {
        ok: false as const,
        error: 'Unable to load user session.',
      };
    }

    const { data: profileData, error: profileError } = await supabase
      .from('user_profiles')
      .select('id,name,role,company_id')
      .eq('id', userId)
      .maybeSingle();

    if (profileError || !profileData?.id) {
      return {
        ok: false as const,
        error: profileError?.message || 'Unable to load user profile.',
      };
    }

    let resolvedCompanyId = String(profileData.company_id || '').trim();

    if (!resolvedCompanyId) {
      const { data: fixedCompany, error: fixedCompanyError } = await supabase
        .from('companies')
        .select('id,name,code')
        .or(`name.eq.${PEZESHA_FALLBACK_NAME},code.eq.${PEZESHA_FALLBACK_NAME}`)
        .limit(1)
        .maybeSingle();

      if (fixedCompanyError || !fixedCompany?.id) {
        return {
          ok: false as const,
          error: fixedCompanyError?.message || 'Unable to resolve Pezesha company.',
        };
      }

      resolvedCompanyId = String(fixedCompany.id);
    }

    return {
      ok: true as const,
      profile: {
        id: String(profileData.id),
        name: profileData.name ?? null,
        role: profileData.role ?? null,
        company_id: resolvedCompanyId,
      } as AuthProfile,
    };
  }

  async function fetchProducts() {
    const res = await fetch('/api/admin/products', {
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

    return (json?.products ?? []) as ProductRow[];
  }

  async function fetchStrategies(nextProductCode?: string) {
    const code = (nextProductCode ?? productCode).trim();
    const qs = code ? `?productCode=${encodeURIComponent(code)}` : '';

    const res = await fetch(`/api/admin/strategies${qs}`, {
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

    return (json?.strategies ?? []) as StrategyRow[];
  }

  async function fetchMappingSelection(productId: string) {
    if (!productId) return [];

    const res = await fetch(`/api/admin/strategies?productId=${encodeURIComponent(productId)}`, {
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

    return ((json?.strategies ?? []) as StrategyRow[]).map((s) => s.id);
  }

  async function refreshAll(nextProductCode?: string, preserveVisible = true) {
    if (!cacheHydrated) return;

    if (!preserveVisible || (strategies.length === 0 && products.length === 0)) {
      setLoading(true);
      setProductsLoading(true);
    } else {
      setRefreshing(true);
    }

    setErrorMsg(null);
    setMappingError(null);

    try {
      const profileResult = await loadProfile();

      if (!profileResult.ok) {
        throw new Error(profileResult.error);
      }

      const nextProfile = profileResult.profile;
      const nextRole = normalizeRole(nextProfile.role);

      setProfile(nextProfile);
      setRole(nextRole);

      const [nextProducts, nextStrategies] = await Promise.all([
        fetchProducts(),
        fetchStrategies(nextProductCode),
      ]);

      setProducts(nextProducts);
      setStrategies(nextStrategies);

      const selectedMappingProductId =
        mappingProductId ||
        (nextProducts.length > 0 ? String(nextProducts[0].id) : '');

      if (!mappingProductId && selectedMappingProductId) {
        setMappingProductId(selectedMappingProductId);
      }

      if ((nextRole === 'admin' || nextRole === 'super_admin') && selectedMappingProductId) {
        setMappingLoading(true);
        const nextMappingSelection = await fetchMappingSelection(selectedMappingProductId);
        setMappingSelection(nextMappingSelection);
        setMappingLoading(false);
      }

      setErrorMsg(null);
      setLoading(false);
      setProductsLoading(false);
      setRefreshing(false);
      setRestoredFromCache(false);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to load strategies.');
      setLoading(false);
      setProductsLoading(false);
      setRefreshing(false);
      setMappingLoading(false);
    }
  }

  async function refreshStrategies(nextProductCode?: string) {
    const preserveVisible = strategies.length > 0 || products.length > 0 || restoredFromCache;

    if (!preserveVisible) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    setErrorMsg(null);

    try {
      const nextStrategies = await fetchStrategies(nextProductCode);
      setStrategies(nextStrategies);
      setLoading(false);
      setRefreshing(false);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to load strategies.');
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function refreshProductsOnly() {
    setProductsLoading(true);
    try {
      const list = await fetchProducts();
      setProducts(list);

      if (!mappingProductId && list.length > 0) {
        setMappingProductId(String(list[0].id));
      }
    } catch {
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }

  async function loadMappingSelection(productId: string) {
    setMappingError(null);
    setMappingMessage(null);

    if (!productId) {
      setMappingSelection([]);
      return;
    }

    setMappingLoading(true);

    try {
      const mapped = await fetchMappingSelection(productId);
      setMappingSelection(mapped);
    } catch (e: any) {
      setMappingError(e?.message || 'Failed to load product mappings.');
    } finally {
      setMappingLoading(false);
    }
  }

  useEffect(() => {
    refreshAll('', true);
  }, [cacheHydrated]);

  useEffect(() => {
    if (mappingProductId && canManageStrategies && cacheHydrated) {
      loadMappingSelection(mappingProductId);
    }
  }, [mappingProductId, canManageStrategies, cacheHydrated]);

  function openAdd() {
    setSaveSuccess(null);
    setSaveError(null);
    setForm({ name: '', description: '', sortOrder: '0', isActive: true });

    const preselected: string[] = [];
    if (productCode) {
      const match = products.find(
        (p) => String(p.code || '').toLowerCase() === productCode.toLowerCase()
      );
      if (match?.id) preselected.push(String(match.id));
    }
    setSelectedProductIds(preselected);

    setIsAddOpen(true);
  }

  function closeAdd() {
    if (saving) return;
    setIsAddOpen(false);
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(null);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      sortOrder: Number(form.sortOrder || 0),
      isActive: form.isActive,
      steps: [],
      productIds: selectedProductIds,
    };

    if (!payload.name) {
      setSaveError('Please enter a strategy name.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/admin/strategies', {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify(payload),
      });

      const { json, text } = await readJsonSafe(res);
      if (!res.ok) {
        const msg = json?.error || (text ? text.slice(0, 180) : 'Failed to create strategy');
        throw new Error(msg);
      }

      setSaveSuccess(`Strategy created: ${json?.strategy?.name || payload.name}`);
      setIsAddOpen(false);
      await refreshStrategies();
      await refreshProductsOnly();
      if (mappingProductId && canManageStrategies) {
        await loadMappingSelection(mappingProductId);
      }
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to create strategy');
    } finally {
      setSaving(false);
    }
  }

  async function saveMappings() {
    setMappingError(null);
    setMappingMessage(null);

    if (!mappingProductId) {
      setMappingError('Please select a product first.');
      return;
    }

    setMappingSaving(true);
    try {
      const res = await fetch('/api/admin/strategies', {
        method: 'PUT',
        headers: await authHeaders(true),
        body: JSON.stringify({
          productId: mappingProductId,
          strategyIds: mappingSelection,
        }),
      });

      const { json, text } = await readJsonSafe(res);
      if (!res.ok) {
        const msg = json?.error || (text ? text.slice(0, 180) : 'Failed to save mappings');
        throw new Error(msg);
      }

      const product = activeProducts.find((p) => p.id === mappingProductId);
      setMappingMessage(
        `Mappings saved for ${product?.name || 'selected product'}. ${mappingSelection.length} strategy(s) selected.`
      );
      await refreshStrategies();
      await loadMappingSelection(mappingProductId);
    } catch (err: any) {
      setMappingError(err?.message || 'Failed to save mappings');
    } finally {
      setMappingSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {isAddOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAdd();
          }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Add Strategy</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Create a strategy template. You can also attach it to products immediately.
                </p>
              </div>

              <button
                type="button"
                onClick={closeAdd}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                disabled={saving}
              >
                Close
              </button>
            </div>

            <form onSubmit={submitAdd} className="space-y-4 p-5">
              {saveError ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {saveError}
                </p>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="e.g. Early Stage Soft Collections"
                    autoFocus
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Description (optional)
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                    className="min-h-[88px] w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="What this strategy is for…"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Sort order</label>
                  <input
                    value={form.sortOrder}
                    onChange={(e) => setForm((p) => ({ ...p, sortOrder: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="0"
                    inputMode="numeric"
                  />
                </div>

                <div className="flex items-end gap-3">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Active
                  </label>
                </div>

                <div className="md:col-span-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block text-sm font-medium text-slate-700">Attach to Products</label>
                    <button
                      type="button"
                      onClick={() => setSelectedProductIds(activeProducts.map((p) => p.id))}
                      className="text-xs font-medium text-slate-600 hover:text-slate-900"
                      disabled={productsLoading || activeProducts.length === 0}
                    >
                      Select all
                    </button>
                  </div>

                  {productsLoading ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                      Loading products…
                    </div>
                  ) : activeProducts.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                      No products found.
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-auto rounded-xl border border-slate-200 p-3">
                      <div className="grid gap-2">
                        {activeProducts.map((p) => {
                          const checked = selectedProductIds.includes(p.id);
                          return (
                            <label
                              key={p.id}
                              className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSelectedProduct(p.id)}
                                className="h-4 w-4 rounded border-slate-300"
                              />
                              <span className="min-w-0 truncate">
                                {p.name}
                                <span className="text-xs text-slate-400"> · {p.code}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="mt-2 text-xs text-slate-500">
                    You can also manage mappings below using the product-first checkbox view.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={closeAdd}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  disabled={saving}
                >
                  {saving ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-slate-900">Strategies</h1>
            {refreshing ? (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                Refreshing…
              </span>
            ) : null}
          </div>

          {restoredFromCache ? (
            <p className="mt-2 text-sm text-slate-500">
              Restored your last strategies view while the latest data loads.
            </p>
          ) : null}

          <p className="mt-1 text-slate-500">
            Manage collection strategies and choose which strategies apply to each product line.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <select
            value={productCode}
            onChange={(e) => {
              const next = e.target.value;
              setProductCode(next);
              refreshStrategies(next);
            }}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            disabled={productsLoading}
            title={productsLoading ? 'Loading products…' : 'Filter strategies by product'}
          >
            <option value="">All Products</option>
            {activeProducts.map((p) => (
              <option key={p.id} value={p.code}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => refreshAll(productCode, true)}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>

          {canManageStrategies ? (
            <button
              type="button"
              onClick={openAdd}
              className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
            >
              Add Strategy
            </button>
          ) : null}
        </div>
      </div>

      {saveSuccess ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {saveSuccess}
        </p>
      ) : null}

      {errorMsg ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load strategies: {errorMsg}
        </p>
      ) : null}

      <div className={`grid gap-6 ${canManageStrategies ? 'xl:grid-cols-[360px,1fr]' : 'xl:grid-cols-1'}`}>
        {canManageStrategies ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Map Strategies to Product</h2>
              <p className="mt-1 text-sm text-slate-500">
                Select a product, then tick the strategies you want available for that product line.
              </p>
            </div>

            {mappingError ? (
              <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {mappingError}
              </p>
            ) : null}

            {mappingMessage ? (
              <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {mappingMessage}
              </p>
            ) : null}

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Choose Product</label>
              <select
                value={mappingProductId}
                onChange={(e) => setMappingProductId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                disabled={productsLoading}
              >
                <option value="">Select product</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMappingSelection(mappingStrategies.map((s) => s.id))}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                disabled={mappingStrategies.length === 0}
              >
                Select All
              </button>

              <button
                type="button"
                onClick={() => setMappingSelection([])}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear All
              </button>

              <button
                type="button"
                onClick={saveMappings}
                disabled={mappingSaving || !mappingProductId}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {mappingSaving ? 'Saving…' : 'Save Mappings'}
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              Selected strategies:{' '}
              <span className="font-medium">
                {mappingLoading ? 'Loading…' : mappingSelection.length}
              </span>
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="section-title">Available Strategies</h2>
              <p className="mt-1 text-sm text-slate-500">
                {canManageStrategies
                  ? 'Tick the strategies you want to make available for the selected product.'
                  : 'View available strategies for your tenant.'}
              </p>
            </div>
          </div>

          {loading && strategies.length === 0 ? (
            <p className="mb-3 text-sm text-slate-500">Loading strategies…</p>
          ) : null}

          {!loading && mappingStrategies.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <p className="text-sm text-slate-600">No strategies found.</p>
            </div>
          ) : null}

          {!loading && mappingStrategies.length > 0 ? (
            <div className="grid gap-3">
              {mappingStrategies.map((s) => {
                const checked = mappingSelection.includes(s.id);

                return (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:bg-slate-50"
                  >
                    {canManageStrategies ? (
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMappingStrategy(s.id)}
                        className="mt-1 h-4 w-4 rounded border-slate-300"
                      />
                    ) : null}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{s.name}</span>
                        <span
                          className={[
                            'inline-flex rounded-full px-3 py-1 text-xs font-medium',
                            s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700',
                          ].join(' ')}
                        >
                          {s.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <span className="text-xs text-slate-400">
                          Sort: {typeof s.sort_order === 'number' ? s.sort_order : '—'}
                        </span>
                      </div>

                      <p className="mt-1 text-sm text-slate-600">{s.description || '—'}</p>

                      <p className="mt-2 text-xs text-slate-500">
                        Currently mapped to:{' '}
                        {s.products && s.products.length > 0
                          ? s.products.map((p) => `${p.name} (${p.code})`).join(', ')
                          : 'No products yet'}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}