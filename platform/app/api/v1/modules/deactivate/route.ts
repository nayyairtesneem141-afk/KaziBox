import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { notifyModuleDeactivated } from '@/lib/notifications';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import { getModule } from '@/lib/modules';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ensureUuid(id: string): string {
  if (id && UUID_REGEX.test(id)) return id;
  return '11111111-1111-4111-8111-111111111111';
}

/**
 * POST /api/v1/modules/deactivate
 * Server-side route to cleanly deactivate a module and revoke workspace access.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(req);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Malformed JSON payload' }, { status: 400 });
  }

  const { moduleId, companyId: inputCompanyId } = body;
  const companyId = ensureUuid(inputCompanyId || session?.companyId || '');

  if (!moduleId) {
    return NextResponse.json({ success: false, error: 'moduleId is required' }, { status: 422 });
  }

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient();
    if (supabase) {
      // 1. Update company_modules status to cancelled
      await supabase
        .from('company_modules')
        .update({ status: 'cancelled' })
        .eq('company_id', companyId)
        .or(`module_id.eq.${moduleId},module_id.eq.${moduleId.replace('-auto', '')}`);

      // 2. Remove from subscriptions.included_module_ids
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (subData && subData.length > 0) {
        for (const sub of subData) {
          const currentList = Array.isArray(sub.included_module_ids) ? (sub.included_module_ids as string[]) : [];
          const updatedList = currentList.filter(
            (id) => id !== moduleId && id !== moduleId.replace('-auto', '')
          );
          await supabase
            .from('subscriptions')
            .update({ included_module_ids: updatedList })
            .eq('id', sub.id);
        }
      }

      const mod = await getModule(moduleId);
      const modName = typeof mod?.name === 'string' ? mod.name : mod?.name?.fr || moduleId;
      await notifyModuleDeactivated(companyId, modName);

      await dispatchWebhookEvent(
        'module.deactivated',
        {
          workspaceId: companyId,
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
