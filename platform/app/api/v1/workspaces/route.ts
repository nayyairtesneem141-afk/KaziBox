import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/server-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { getStore, setStoreItem } from '@/lib/storage';
import { Workspace } from '@kazibox/sdk';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user from cryptographic session (JWT or demo cookie)
    const session = await getServerSession(req);
    if (!session || !session.userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          code: 'NOT_AUTHENTICATED',
          message: 'Veuillez vous connecter pour créer une entreprise.',
        },
        { status: 401 }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'INVALID_JSON', message: 'Format JSON invalide' },
        { status: 400 }
      );
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const country = typeof body?.country === 'string' ? body.country.trim() : 'Côte d’Ivoire';
    const currency = typeof body?.currency === 'string' ? body.currency.trim().toUpperCase() : 'XOF';
    const language = typeof body?.language === 'string' ? body.language.trim() : 'fr';
    const logoUrl = typeof body?.logo_url === 'string' ? body.logo_url.trim() : '';

    if (!name || name.length < 2) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_NAME',
          message: 'Le nom de l’entreprise doit comporter au moins 2 caractères.',
        },
        { status: 400 }
      );
    }

    // 2. Primary Path: Supabase Admin with atomic RPC or compensating rollback
    if (isSupabaseConfigured()) {
      const adminClient = createAdminClient();
      if (!adminClient) {
        return NextResponse.json(
          { success: false, error: 'SERVER_CONFIG_ERROR', message: 'Base de données momentanément indisponible.' },
          { status: 500 }
        );
      }

      // Try atomic RPC first
      const { data: rpcCompany, error: rpcError } = await (adminClient as any).rpc(
        'create_additional_workspace',
        {
          p_user_id: session.userId,
          p_name: name,
          p_country: country,
          p_currency: currency,
          p_language: language,
          p_logo_url: logoUrl || null,
        }
      );

      if (!rpcError && rpcCompany) {
        const workspace: Workspace = {
          id: rpcCompany.id,
          company_id: rpcCompany.id,
          name: rpcCompany.name,
          country: rpcCompany.country,
          currency: rpcCompany.currency,
          language: rpcCompany.language,
          logo_url: rpcCompany.logo_url || '',
          created_at: rpcCompany.created_at,
          plan: rpcCompany.plan,
          status: rpcCompany.status,
        };

        const res = NextResponse.json({ success: true, workspace }, { status: 201 });
        res.cookies.set('kazibox_session', encodeURIComponent(
          JSON.stringify({ userId: session.userId, companyId: workspace.company_id })
        ), {
          path: '/',
          maxAge: 604800,
          sameSite: 'lax',
          httpOnly: false,
        });
        return res;
      }

      // Fallback: If RPC not yet applied, perform atomic compensating rollback
      let insertedCompanyId: string | null = null;
      try {
        const { data: newCompany, error: compErr } = await (adminClient as any)
          .from('companies')
          .insert({
            name,
            country,
            currency,
            language,
            logo_url: logoUrl || null,
            plan: 'starter',
            status: 'active',
          })
          .select()
          .single();

        if (compErr || !newCompany) {
          throw new Error(compErr?.message || 'Erreur création entreprise');
        }

        insertedCompanyId = newCompany.id;

        // Associate user as owner in team_members
        const { error: teamErr } = await (adminClient as any).from('team_members').insert({
          company_id: insertedCompanyId,
          user_id: session.userId,
          name: session.name || 'Owner',
          email: session.email,
          role: 'owner',
          status: 'active',
        });

        if (teamErr) {
          throw new Error(`Erreur association propriétaire: ${teamErr.message}`);
        }

        // Create starter subscription
        await (adminClient as any).from('subscriptions').insert({
          company_id: insertedCompanyId,
          plan_id: 'starter',
          status: 'active',
          current_period_start: new Date().toISOString(),
          included_module_ids: [],
        });

        const workspace: Workspace = {
          id: newCompany.id,
          company_id: newCompany.id,
          name: newCompany.name,
          country: newCompany.country,
          currency: newCompany.currency,
          language: newCompany.language,
          logo_url: newCompany.logo_url || '',
          created_at: newCompany.created_at,
          plan: newCompany.plan,
          status: newCompany.status,
        };

        const res = NextResponse.json({ success: true, workspace }, { status: 201 });
        res.cookies.set('kazibox_session', encodeURIComponent(
          JSON.stringify({ userId: session.userId, companyId: workspace.company_id })
        ), {
          path: '/',
          maxAge: 604800,
          sameSite: 'lax',
          httpOnly: false,
        });
        return res;
      } catch (err: any) {
        // Rollback: clean up orphaned company if team membership failed
        if (insertedCompanyId) {
          await (adminClient as any).from('companies').delete().eq('id', insertedCompanyId);
        }
        return NextResponse.json(
          { success: false, error: 'WORKSPACE_CREATION_FAILED', message: err?.message || 'Erreur lors de la création de l’espace.' },
          { status: 500 }
        );
      }
    }

    // 3. Fallback Path: In-memory store (demo/offline mode)
    const store = getStore();
    const newId = `ws-${Date.now()}`;
    const workspace: Workspace = {
      id: newId,
      company_id: newId,
      name,
      country,
      currency,
      language,
      logo_url: logoUrl || '',
      created_at: new Date().toISOString(),
      plan: 'starter',
      status: 'active',
    };

    store.workspaces.push(workspace);
    setStoreItem('WORKSPACES', store.workspaces);

    // Add owner team member in store
    const member = {
      id: `tm-${Date.now()}`,
      company_id: newId,
      user_id: session.userId,
      name: session.name || 'Owner',
      email: session.email || '',
      role: 'owner' as const,
      status: 'active' as const,
      joined_at: new Date().toISOString(),
    };
    store.members.push(member);
    setStoreItem('MEMBERS', store.members);

    const res = NextResponse.json({ success: true, workspace }, { status: 201 });
    res.cookies.set('kazibox_session', encodeURIComponent(
      JSON.stringify({ userId: session.userId, companyId: newId })
    ), {
      path: '/',
      maxAge: 604800,
      sameSite: 'lax',
      httpOnly: false,
    });
    return res;
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'SERVER_ERROR', message: error?.message || 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}
