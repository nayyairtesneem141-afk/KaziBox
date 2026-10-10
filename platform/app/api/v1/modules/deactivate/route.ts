import { NextRequest, NextResponse } from 'next/server';
import { getServerSession, sessionBelongsToCompany, isPrivilegedRole } from '@/lib/server-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { notifyModuleDeactivated } from '@/lib/notifications';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import { getModule } from '@/lib/modules';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/modules/deactivate
 *
 * Security requirements (per Phase 1 remediation):
 *   - Caller must supply a valid kazibox_session cookie.
 *   - The session's companyId must match the requested companyId body field.
 *   - Caller must hold the `owner` or `platform_admin` role.
 *   - The service-role DB write only executes after all checks pass.
 */
export async function POST(req: NextRequest) {
  // ── 1. Authenticate ───────────────────────────────────────────────────────
  const session = await getServerSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized', code: 'NOT_AUTHENTICATED' },
      { status: 401 }
    );
  }

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Malformed JSON payload' },
      { status: 400 }
    );
  }

  const { moduleId, companyId: requestedCompanyId } = body;

  if (!moduleId) {
    return NextResponse.json(
      { success: false, error: 'moduleId is required' },
      { status: 422 }
    );
  }

  // ── 3. Authorise: session company must match request company ──────────────
  const effectiveCompanyId =
    session.role === 'platform_admin' && requestedCompanyId
      ? requestedCompanyId
      : session.companyId;

  if (session.role !== 'platform_admin' && requestedCompanyId && requestedCompanyId !== session.companyId) {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden',
        code: 'COMPANY_MISMATCH',
        message: 'You can only deactivate modules for your own workspace.',
      },
      { status: 403 }
    );
  }

  // ── 4. Role check: only owners and platform admins may deactivate ─────────
  if (!isPrivilegedRole(session)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden',
        code: 'INSUFFICIENT_ROLE',
        message: 'Only workspace owners or platform administrators can deactivate modules.',
      },
      { status: 403 }
    );
  }

  // ── 5. Perform the write with the service-role client ─────────────────────
  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const isSalon = ['hair-salon', 'salon', 'salon-beauty'].includes(moduleId);
      const isGarage = ['garage-auto', 'garage'].includes(moduleId);
      const targetIds = isSalon
        ? ['hair-salon', 'salon', 'salon-beauty']
        : isGarage
        ? ['garage-auto', 'garage']
        : [moduleId, moduleId.replace('-auto', '')];

      for (const tId of targetIds) {
        await supabase
          .from('company_modules')
          .update({ status: 'cancelled' })
          .eq('company_id', effectiveCompanyId)
          .eq('module_id', tId);
      }

      const { data: subData } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('company_id', effectiveCompanyId)
        .order('created_at', { ascending: false });

      if (subData && subData.length > 0) {
        for (const sub of subData) {
          const currentList = Array.isArray(sub.included_module_ids)
            ? (sub.included_module_ids as string[])
            : [];
          const updatedList = currentList.filter((id) => !targetIds.includes(id));
          await supabase
            .from('subscriptions')
            .update({ included_module_ids: updatedList })
            .eq('id', sub.id);
        }
      }

      const mod = await getModule(moduleId);
      const modName = typeof mod?.name === 'string' ? mod.name : mod?.name?.fr || moduleId;
      await notifyModuleDeactivated(effectiveCompanyId, modName);

      await dispatchWebhookEvent(
        'module.deactivated',
        {
          workspaceId: effectiveCompanyId,
          moduleId,
          deactivatedAt: new Date().toISOString(),
          dataRetentionDays: 30,
        },
        moduleId
      );

      return NextResponse.json({
        success: true,
        message: 'Vos données sont conservées pendant 30 jours.',
      });
    }
  }

  return NextResponse.json({
    success: true,
    message: 'Vos données sont conservées pendant 30 jours.',
  });
}
