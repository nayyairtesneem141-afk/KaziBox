import { NextRequest, NextResponse } from 'next/server';
import { getServerSession, sessionBelongsToCompany, isPrivilegedRole } from '@/lib/server-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { notifyModuleActivated } from '@/lib/notifications';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import { getModule } from '@/lib/modules';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/modules/activate
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
  // platform_admin may supply any companyId; regular owners are limited to their own.
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
        message: 'You can only activate modules for your own workspace.',
      },
      { status: 403 }
    );
  }

  // ── 4. Role check: only owners and platform admins may activate ───────────
  if (!isPrivilegedRole(session)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden',
        code: 'INSUFFICIENT_ROLE',
        message: 'Only workspace owners or platform administrators can activate modules.',
      },
      { status: 403 }
    );
  }

  // ── 5. Perform the write with the service-role client ─────────────────────
  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const { data: existing } = await supabase
        .from('company_modules')
        .select('*')
        .eq('company_id', effectiveCompanyId)
        .eq('module_id', moduleId)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('company_modules')
          .update({ status: 'active', activated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase.from('company_modules').insert({
          company_id: effectiveCompanyId,
          module_id: moduleId,
          plan_id: 'starter',
          status: 'active',
          activated_at: new Date().toISOString(),
        });
      }

      const { data: subData } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('company_id', effectiveCompanyId)
        .order('created_at', { ascending: false })
        .maybeSingle();

      if (subData) {
        const currentList = Array.isArray(subData.included_module_ids)
          ? (subData.included_module_ids as string[])
          : [];
        if (!currentList.includes(moduleId)) {
          await supabase
            .from('subscriptions')
            .update({ included_module_ids: [...currentList, moduleId] })
            .eq('id', subData.id);
        }
      }

      const mod = await getModule(moduleId);
      const modName = typeof mod?.name === 'string' ? mod.name : mod?.name?.fr || moduleId;
      await notifyModuleActivated(effectiveCompanyId, modName);

      await dispatchWebhookEvent(
        'module.activated',
        {
          workspaceId: effectiveCompanyId,
          moduleId,
          activatedAt: new Date().toISOString(),
        },
        moduleId
      );

      return NextResponse.json({ success: true });
    }
  }

  // Supabase not configured – in-memory / local-storage demo mode only
  return NextResponse.json({ success: true });
}
