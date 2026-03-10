'use client';

import { useEffect, useMemo, useState } from 'react';

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

async function readJsonSafe(res: Response) {
  const text = await res.text();
  if (!text) return { json: null as any, text: '' };
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null as any, text };
  }
}

export default function StrategiesPage() {
  const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY || '';

  const [loading, setLoading] = useState(true);
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

  async function refreshProducts() {
    setProductsLoading(true);
    try {
      const res = await fetch('/api/admin/products', {
        headers: { 'x-admin-key': ADMIN_KEY },
        cache: 'no-store',
      });

      const { json, text } = await readJsonSafe(res);
      if (!res.ok) {
        const msg =
          json?.error || (text ? text.slice(0, 180) : `Request failed (${res.status}) with empty body`);
        throw new Error(msg);
      }

      const list = (json?.products ?? []) as ProductRow[];
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

  async function refreshStrategies(nextProductCode?: string) {
    setLoading(true);
    setErrorMsg(null);

    const code = (nextProductCode ?? productCode).trim();
    const qs = code ? `?productCode=${encodeURIComponent(code)}` : '';

    try {
      const res = await fetch(`/api/admin/strategies${qs}`, {
        headers: { 'x-admin-key': ADMIN_KEY },
        cache: 'no-store',
      });

      const { json, text } = await readJsonSafe(res);

      if (!res.ok) {
        const msg =
          json?.error || (text ? text.slice(0, 180) : `Request failed (${res.status}) with empty body`);
        throw new Error(msg);
      }

      setStrategies((json?.strategies ?? []) as StrategyRow[]);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to load strategies.');
    } finally {
      setLoading(false);
    }
  }

  async function loadMappingSelection(productId: string) {
    setMappingError(null);
    setMappingMessage(null);

    if (!productId) {
      setMappingSelection([]);
      return;
    }

    try {
      const res = await fetch(`/api/admin/strategies?productId=${encodeURIComponent(productId)}`, {
        headers: { 'x-admin-key': ADMIN_KEY },
        cache: 'no-store',
      });

      const { json, text } = await readJsonSafe(res);
      if (!res.ok) {
        const msg =
          json?.error || (text ? text.slice(0, 180) : `Request failed (${res.status}) with empty body`);
        throw new Error(msg);
      }

      const mapped = ((json?.strategies ?? []) as StrategyRow[]).map((s) => s.id);
      setMappingSelection(mapped);
    } catch (e: any) {
      setMappingError(e?.message || 'Failed to load product mappings.');
    }
  }

  useEffect(() => {
    refreshProducts();
    refreshStrategies('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mappingProductId) {
      loadMappingSelection(mappingProductId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappingProductId]);

  function openAdd() {
    setSaveSuccess(null);
    setSaveError(null);
    setForm({ name: '', description: '', sortOrder: '0', isActive: true });

    const preselected: string[] = [];
    if (productCode) {
      const match = products.find((p) => String(p.code || '').toLowerCase() === productCode.toLowerCase());
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
        headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
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
      if (mappingProductId) {
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
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': ADMIN_KEY,
        },
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
                            <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
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
          <h1 className="text-3xl font-semibold text-slate-900">Strategies</h1>
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
            onClick={() => refreshStrategies()}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={openAdd}
            className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
          >
            Add Strategy
          </button>
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

      <div className="grid gap-6 xl:grid-cols-[360px,1fr]">
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
            Selected strategies: <span className="font-medium">{mappingSelection.length}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="section-title">Available Strategies</h2>
              <p className="mt-1 text-sm text-slate-500">
                Tick the strategies you want to make available for the selected product.
              </p>
            </div>
          </div>

          {loading ? <p className="mb-3 text-sm text-slate-500">Loading strategies…</p> : null}

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
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMappingStrategy(s.id)}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />

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