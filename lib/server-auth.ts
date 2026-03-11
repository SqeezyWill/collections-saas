import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';

type Role = 'agent' | 'admin' | 'super_admin';

function normalizeRole(value: unknown): Role | '' {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'agent' || role === 'admin' || role === 'super_admin') return role;
  return '';
}

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  return authHeader.slice(7).trim() || null;
}

export async function getRequestUserProfile(req: NextRequest) {
  if (!supabaseAdmin) {
    return { error: 'Supabase admin not configured.', status: 500 as const };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return { error: 'Supabase client env is not configured.', status: 500 as const };
  }

  const token = getBearerToken(req);
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

  return {
    user: {
      id: String(profile.id),
      name: profile.name ?? null,
      email: profile.email ?? null,
      role,
      companyId: profile.company_id ?? null,
    },
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