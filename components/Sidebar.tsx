'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Briefcase,
  ChevronDown,
  ChevronLeft,
  CreditCard,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Upload,
  Wallet,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

type UserProfile = {
  id: string;
  role: string | null;
  company_id?: string | null;
};

type NavLink = {
  href: string;
  label: string;
  icon: any;
};

const baseLinks: NavLink[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/accounts', label: 'Accounts', icon: Briefcase },
  { href: '/strategies', label: 'Strategies', icon: GitBranch },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/admin', label: 'Admin', icon: ShieldCheck },
];

const recoveryReportLinks: NavLink[] = [
  { href: '/payments', label: 'Payments', icon: Wallet },
  { href: '/ptps', label: 'PTPs', icon: CreditCard },
];

const uploadToolLinks: NavLink[] = [
  { href: '/accounts/upload', label: 'New Accounts Upload', icon: Upload },
  { href: '/accounts/update-upload', label: 'Accounts Update Upload', icon: Upload },
  { href: '/accounts/product-upload', label: 'Product Upload', icon: Upload },
];

const STORAGE_KEY = 'sidebar_collapsed_v1';
const PIN_KEY = 'sidebar_pinned_open_v1';
const TOGGLE_EVENT = 'app:toggle-sidebar';

function normalizeRole(role: string | null | undefined) {
  return String(role || '').trim().toLowerCase();
}

function linksForRole(role: string) {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === 'super_admin') {
    return {
      links: baseLinks,
      recoveryLinks: recoveryReportLinks,
      uploadLinks: uploadToolLinks,
    };
  }

  if (normalizedRole === 'admin') {
    return {
      links: baseLinks.filter((link) => link.href !== '/admin'),
      recoveryLinks: recoveryReportLinks,
      uploadLinks: uploadToolLinks,
    };
  }

  if (normalizedRole === 'agent') {
    return {
      links: baseLinks.filter((link) => ['/dashboard', '/accounts'].includes(link.href)),
      recoveryLinks: recoveryReportLinks,
      uploadLinks: [],
    };
  }

  return {
    links: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
    recoveryLinks: [],
    uploadLinks: [],
  };
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [role, setRole] = useState('agent');
  const [reportsOpen, setReportsOpen] = useState(true);
  const [uploadToolsOpen, setUploadToolsOpen] = useState(true);

  const hoverCloseTimer = useRef<number | null>(null);

  useEffect(() => {
    async function loadRole() {
      if (!supabase) return;

      const { data: sessionData } = await supabase.auth.getSession();
      const sessionUser = sessionData.session?.user;

      if (!sessionUser?.id) return;

      const metadataRole = String(sessionUser.user_metadata?.role || '').trim();
      if (metadataRole) {
        setRole(metadataRole);
        return;
      }

      const { data } = await supabase
        .from('user_profiles')
        .select('id,role')
        .eq('id', sessionUser.id)
        .maybeSingle();

      const profile = data as UserProfile | null;
      if (profile?.role) {
        setRole(profile.role);
      }
    }

    loadRole();
  }, []);

  const { links, recoveryLinks, uploadLinks } = useMemo(() => linksForRole(role), [role]);

  useEffect(() => {
    try {
      const rawCollapsed = window.localStorage.getItem(STORAGE_KEY);
      const rawPinned = window.localStorage.getItem(PIN_KEY);

      if (rawCollapsed === '1') setCollapsed(true);
      if (rawPinned === '1') setPinnedOpen(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PIN_KEY, pinnedOpen ? '1' : '0');
    } catch {
      // ignore
    }
  }, [pinnedOpen]);

  useEffect(() => {
    function handleToggle() {
      const effectiveCollapsed = getEffectiveCollapsed(collapsed, pinnedOpen, isHovering);
      if (!effectiveCollapsed) {
        setPinnedOpen(false);
        setCollapsed(true);
        return;
      }

      setCollapsed(false);
      setPinnedOpen(true);
    }

    window.addEventListener(TOGGLE_EVENT, handleToggle);
    return () => window.removeEventListener(TOGGLE_EVENT, handleToggle);
  }, [collapsed, pinnedOpen, isHovering]);

  const effectiveCollapsed = getEffectiveCollapsed(collapsed, pinnedOpen, isHovering);

  const activeHref = useMemo(() => {
    const candidates = [...links, ...recoveryLinks, ...uploadLinks].sort(
      (a, b) => b.href.length - a.href.length
    );

    return (
      candidates.find((l) => pathname === l.href || pathname.startsWith(`${l.href}/`))?.href || ''
    );
  }, [pathname, links, recoveryLinks, uploadLinks]);

  const isRecoverySectionActive = recoveryLinks.some(
    (link) => pathname === link.href || pathname.startsWith(`${link.href}/`)
  );

  const isUploadSectionActive = uploadLinks.some(
    (link) => pathname === link.href || pathname.startsWith(`${link.href}/`)
  );

  useEffect(() => {
    if (isRecoverySectionActive) {
      setReportsOpen(true);
    }
  }, [isRecoverySectionActive]);

  useEffect(() => {
    if (isUploadSectionActive) {
      setUploadToolsOpen(true);
    }
  }, [isUploadSectionActive]);

  function handleMouseEnter() {
    if (pinnedOpen) return;
    if (hoverCloseTimer.current) {
      window.clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
    setIsHovering(true);
  }

  function handleMouseLeave() {
    if (pinnedOpen) return;

    hoverCloseTimer.current = window.setTimeout(() => {
      setIsHovering(false);
      hoverCloseTimer.current = null;
    }, 140);
  }

  function togglePinned() {
    if (pinnedOpen) {
      setPinnedOpen(false);
      setCollapsed(true);
      return;
    }

    setCollapsed(false);
    setPinnedOpen(true);
  }

  async function handleLogout() {
    if (loggingOut) return;

    setLoggingOut(true);

    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
    } finally {
      router.replace('/login');
      router.refresh();
      setLoggingOut(false);
    }
  }

  return (
    <div className="hidden h-screen lg:block" style={{ perspective: 1200 }}>
      <aside
        aria-label="Sidebar"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={[
          'relative sticky top-0 h-screen shrink-0 overflow-hidden border-r border-slate-200 bg-slate-950 text-white',
          'transition-[width] duration-300 ease-out',
          effectiveCollapsed ? 'w-20' : 'w-72',
        ].join(' ')}
      >
        <div
          className={[
            'relative flex min-h-screen h-full flex-col origin-left',
            'transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
            effectiveCollapsed ? '[transform:rotateY(-18deg)]' : '[transform:rotateY(0deg)]',
          ].join(' ')}
          style={{ transformStyle: 'preserve-3d' }}
        >
          <div
            className="pointer-events-none absolute right-0 top-0 h-full w-[10px]"
            style={{
              background:
                'linear-gradient(to right, rgba(255,255,255,0.00), rgba(255,255,255,0.10))',
              opacity: effectiveCollapsed ? 1 : 0.6,
              transition: 'opacity 400ms ease',
            }}
          />

          <div className="border-b border-slate-800 px-4 py-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                  {effectiveCollapsed ? 'CS' : 'Collections SaaS'}
                </p>
                {!effectiveCollapsed ? (
                  <h2 className="mt-2 text-xl font-semibold">Admin Workspace</h2>
                ) : (
                  <h2 className="mt-2 text-sm font-semibold text-slate-200">Workspace</h2>
                )}
              </div>

              <button
                type="button"
                onClick={togglePinned}
                className="group inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/40 text-slate-200 hover:bg-slate-900 hover:text-white"
                aria-label={pinnedOpen ? 'Unpin sidebar and collapse' : 'Pin sidebar open'}
                title={pinnedOpen ? 'Unpin (auto collapse)' : 'Pin open'}
              >
                <ChevronLeft
                  size={18}
                  className={[
                    'transition-transform duration-300',
                    effectiveCollapsed ? 'rotate-180' : 'rotate-0',
                  ].join(' ')}
                />
              </button>
            </div>
          </div>

          <nav className="flex-1 space-y-1 px-3 py-5">
            {links.map(({ href, label, icon: Icon }) => {
              const isActive = href === activeHref;

              return (
                <Link
                  key={href}
                  href={href}
                  className={[
                    'group relative flex items-center gap-3 rounded-xl px-3 py-3 transition',
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-white',
                    effectiveCollapsed ? 'justify-center' : '',
                  ].join(' ')}
                  title={effectiveCollapsed ? label : undefined}
                >
                  <Icon size={18} />
                  {!effectiveCollapsed ? <span className="truncate">{label}</span> : null}

                  {effectiveCollapsed ? (
                    <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg opacity-0 translate-x-[-4px] transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
                      {label}
                    </span>
                  ) : null}
                </Link>
              );
            })}

            {recoveryLinks.length > 0 ? (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setReportsOpen((prev) => !prev)}
                  className={[
                    'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition',
                    isRecoverySectionActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-white',
                    effectiveCollapsed ? 'justify-center' : '',
                  ].join(' ')}
                  title={effectiveCollapsed ? 'Recovery Reports' : undefined}
                >
                  <FolderKanban size={18} />
                  {!effectiveCollapsed ? (
                    <>
                      <span className="flex-1 truncate">Recovery Reports</span>
                      <ChevronDown
                        size={16}
                        className={`transition-transform ${reportsOpen ? 'rotate-180' : 'rotate-0'}`}
                      />
                    </>
                  ) : null}
                </button>

                {!effectiveCollapsed && reportsOpen ? (
                  <div className="mt-1 space-y-1 pl-4">
                    {recoveryLinks.map(({ href, label, icon: Icon }) => {
                      const isActive = href === activeHref;

                      return (
                        <Link
                          key={href}
                          href={href}
                          className={[
                            'flex items-center gap-3 rounded-xl px-3 py-3 transition',
                            isActive
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-300 hover:bg-slate-900 hover:text-white',
                          ].join(' ')}
                        >
                          <Icon size={16} />
                          <span className="truncate">{label}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {uploadLinks.length > 0 ? (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setUploadToolsOpen((prev) => !prev)}
                  className={[
                    'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition',
                    isUploadSectionActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-white',
                    effectiveCollapsed ? 'justify-center' : '',
                  ].join(' ')}
                  title={effectiveCollapsed ? 'Upload Tools' : undefined}
                >
                  <Upload size={18} />
                  {!effectiveCollapsed ? (
                    <>
                      <span className="flex-1 truncate">Upload Tools</span>
                      <ChevronDown
                        size={16}
                        className={`transition-transform ${uploadToolsOpen ? 'rotate-180' : 'rotate-0'}`}
                      />
                    </>
                  ) : null}
                </button>

                {!effectiveCollapsed && uploadToolsOpen ? (
                  <div className="mt-1 space-y-1 pl-4">
                    {uploadLinks.map(({ href, label, icon: Icon }) => {
                      const isActive = href === activeHref;

                      return (
                        <Link
                          key={href}
                          href={href}
                          className={[
                            'flex items-center gap-3 rounded-xl px-3 py-3 transition',
                            isActive
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-300 hover:bg-slate-900 hover:text-white',
                          ].join(' ')}
                        >
                          <Icon size={16} />
                          <span className="truncate">{label}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleLogout}
              className={[
                'group relative flex w-full items-center gap-3 rounded-xl px-3 py-3 transition',
                'text-slate-300 hover:bg-slate-900 hover:text-white',
                effectiveCollapsed ? 'justify-center' : '',
              ].join(' ')}
              title={effectiveCollapsed ? 'Logout' : undefined}
              disabled={loggingOut}
            >
              <LogOut size={18} />
              {!effectiveCollapsed ? (
                <span className="truncate">{loggingOut ? 'Signing out...' : 'Logout'}</span>
              ) : null}

              {effectiveCollapsed ? (
                <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg opacity-0 translate-x-[-4px] transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
                  {loggingOut ? 'Signing out...' : 'Logout'}
                </span>
              ) : null}
            </button>
          </nav>
        </div>
      </aside>
    </div>
  );
}

function getEffectiveCollapsed(collapsed: boolean, pinnedOpen: boolean, isHovering: boolean) {
  if (pinnedOpen) return false;
  if (isHovering) return false;
  return collapsed;
}