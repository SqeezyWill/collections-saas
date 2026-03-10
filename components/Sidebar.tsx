'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Briefcase,
  ChevronLeft,
  CreditCard,
  GitBranch,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Wallet,
  Upload,
} from 'lucide-react';

const links = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/accounts', label: 'Accounts', icon: Briefcase },
  { href: '/collectors', label: 'Collectors', icon: BarChart3 },
  { href: '/payments', label: 'Payments', icon: Wallet },
  { href: '/ptps', label: 'PTPs', icon: CreditCard },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/strategies', label: 'Strategies', icon: GitBranch },
  { href: '/upload-jobs', label: 'Upload Jobs', icon: Upload },
  { href: '/admin', label: 'Admin', icon: ShieldCheck },
  { href: '/login', label: 'Logout', icon: LogOut },
];

const STORAGE_KEY = 'sidebar_collapsed_v1';
const PIN_KEY = 'sidebar_pinned_open_v1';
const TOGGLE_EVENT = 'app:toggle-sidebar';

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const hoverCloseTimer = useRef<number | null>(null);

  useEffect(() => {
    try {
      const rawCollapsed = window.localStorage.getItem(STORAGE_KEY);
      const rawPinned = window.localStorage.getItem(PIN_KEY);

      if (rawCollapsed === '1') setCollapsed(true);
      if (rawPinned === '1') setPinnedOpen(true);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {}
  }, [collapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PIN_KEY, pinnedOpen ? '1' : '0');
    } catch {}
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
    const candidates = links
      .filter((l) => l.href !== '/login')
      .sort((a, b) => b.href.length - a.href.length);

    return (
      candidates.find((l) => pathname === l.href || pathname.startsWith(`${l.href}/`))?.href ||
      ''
    );
  }, [pathname]);

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
              const isActive = href === '/login' ? false : href === activeHref;

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