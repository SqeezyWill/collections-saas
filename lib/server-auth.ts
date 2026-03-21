import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';

type Role = 'agent' | 'admin' | 'super_admin';

function normalizeRole(value: unknown): Role | '' {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'agent' || role === 'admin' || role === 'super_admin') return role;
  return '';
}

function getBearerToken(req?: NextRequest) {
  if (!req) return null;
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  return authHeader.slice(7).trim() || null;
}

function extractTokenFromCookieValue(raw: string | undefined | null) {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);

    if (typeof parsed === 'string') {
      return parsed || null;
    }

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === 'string' && item.trim()) return item.trim();
        if (item && typeof item === 'object' && 'access_token' in item) {
          const token = String((item as any).access_token || '').trim();
          if (token) return token;
        }
      }
    }

    if (parsed && typeof parsed === 'object' && 'access_token' in parsed) {
      const token = String((parsed as any).access_token || '').trim();
      if (token) return token;
    }
  } catch {
    const trimmed = String(raw).trim();
    if (trimmed) return trimmed;
  }

  return null;
}

async function getCookieToken() {
  const store = await cookies();
  const all = store.getAll();

  const authCookies = all.filter((cookie) =>
    /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name)
  );

  if (!authCookies.length) {
    return null;
  }

  const baseNames = Array.from(
    new Set(authCookies.map((cookie) => cookie.name.replace(/\.\d+$/, '')))
  );

  for (const baseName of baseNames) {
    const matching = authCookies
      .filter((cookie) => cookie.name === baseName || cookie.name.startsWith(`${baseName}.`))
      .sort((a, b) => {
        const aMatch = a.name.match(/\.(\d+)$/);
        const bMatch = b.name.match(/\.(\d+)$/);
        const aIndex = aMatch ? Number(aMatch[1]) : 0;
        const bIndex = bMatch ? Number(bMatch[1]) : 0;
        return aIndex - bIndex;
      });

    const combined = matching.map((cookie) => cookie.value).join('');
    const token = extractTokenFromCookieValue(combined);

    if (token) return token;
  }

  return null;
}

export async function getRequestUserProfile(req?: NextRequest) {
  if (!supabaseAdmin) {
    return { error: 'Supabase admin not configured.', status: 500 as const };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return { error: 'Supabase client env is not configured.', status: 500 as const };
  }

  const bearerToken = getBearerToken(req);
  const cookieToken = bearerToken ? null : await getCookieToken();
  const token = bearerToken || cookieToken;

  if (!token) {
    return { error: 'Unauthorized', status: 401 as const };
  }

  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await authClient.auth.getUser(token);

  if (authError || !authData.user) {
    return { error: 'Unauthorized', status: 401 as const };
  }

  const userId = authData.user.id;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('id,name,email,role,company_id')
    .eq('id', userId)
    .maybeSingle();

  if (profileError || !profile) {
    return { error: 'Forbidden', status: 403 as const };
  }

  const role = normalizeRole(profile.role);
  if (!role) {
    return { error: 'Forbidden', status: 403 as const };
  }

  const user = {
    id: String(profile.id),
    name: profile.name ?? null,
    email: profile.email ?? null,
    role,
    companyId: profile.company_id ?? null,
  };

  return {
    user,
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    company_id: user.companyId,
  };
}

export async function requireAdminRole(req: NextRequest) {
  const result = await getRequestUserProfile(req);
  if ('error' in result) return result;

  if (result.user.role !== 'admin' && result.user.role !== 'super_admin') {
    return { error: 'Forbidden', status: 403 as const };
  }

  return result;
}

export async function requireSuperAdminRole(req: NextRequest) {
  const result = await getRequestUserProfile(req);
  if ('error' in result) return result;

  if (result.user.role !== 'super_admin') {
    return { error: 'Forbidden', status: 403 as const };
  }

  return result;
}