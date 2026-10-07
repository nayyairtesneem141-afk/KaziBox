import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { notifyModuleActivated } from '@/lib/notifications';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import { getModule } from '@/lib/modules';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ensureUuid(id: string): string {
  if (id && UUID_REGEX.test(id)) return id;
  return '11111111-1111-4111-8111-111111111111';
}

/**
 * POST /api/v1/modules/activate
 * Server-side route to activate a module for workspace.
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
      // 1. Upsert company_modules
      const { data: existing } = await supabase
        .from('company_modules')
        .select('*')
        .eq('company_id', companyId)
        .eq('module_id', moduleId)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('company_modules')
          .update({ status: 'active', activated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('company_modules')
          .insert({
            company_id: companyId,
            module_id: moduleId,
            plan_id: 'starter',
            status: 'active',
            activated_at: new Date().toISOString(),
          });
      }

      // 2. Add to subscriptions.included_module_ids
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .maybeSingle();

      if (subData) {
        const currentList = Array.isArray(subData.included_module_ids) ? (subData.included_module_ids as string[]) : [];
        if (!currentList.includes(moduleId)) {
          await supabase
            .from('subscriptions')
            .update({ included_module_ids: [...currentList, moduleId] })
            .eq('id', subData.id);
        }
      }

      const mod = await getModule(moduleId);
      const modName = typeof mod?.name === 'string' ? mod.name : mod?.name?.fr || moduleId;
      await notifyModuleActivated(companyId, modName);

      await dispatchWebhookEvent(
        'module.activated',
        {
          workspaceId: companyId,
          moduleId,
          activatedAt: new Date().toISOString(),
        },
        moduleId
      );

      return NextResponse.json({ success: true });
    }
  }

  return NextResponse.json({ success: true });
}
