import Link from 'next/link';
import { useRouter } from 'next/router';
import React from 'react';

const links = [
  { href: '/', label: 'Overview' },
  { href: '/posts', label: 'Posts' },
  { href: '/messages', label: 'Messages' },
  { href: '/logs', label: 'Logs' },
  { href: '/settings', label: 'Settings' },
];

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-wrap items-center gap-6 py-4">
            <p className="font-semibold text-lg">Tarasa Dashboard</p>
            <div className="flex flex-wrap gap-4 text-sm">
              {links.map((link) => {
                const isActive = router.pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`pb-1 border-b-2 ${
                      isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto py-8 px-4">{children}</main>
    </div>
  );
};

export default Layout;
