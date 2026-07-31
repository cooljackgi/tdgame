import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import AdminHeader from '@/components/admin/AdminHeader';
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = cookies().get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidAdminSession(session)) redirect('/admin-login');

  return (
    <div className="min-h-screen bg-muted/15">
      <AdminHeader />
      {children}
    </div>
  );
}
