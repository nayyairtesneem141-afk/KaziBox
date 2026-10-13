import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase/config';
import { getStore, setStoreItem } from '@/lib/storage';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name,
      email,
      password,
      companyName,
      country = 'Côte d’Ivoire',
      currency = 'XOF',
      phone,
    } = body || {};

    // ── Input Validation ────────────────────────────────────────────────────────
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanPassword = typeof password === 'string' ? password : '';
    const cleanCompanyName = typeof companyName === 'string' ? companyName.trim() : '';
    const cleanCountry = typeof country === 'string' ? country.trim() : 'Côte d’Ivoire';
    const cleanCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : 'XOF';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : undefined;

    if (!cleanName || cleanName.length < 2) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_NAME',
          message: 'Veuillez saisir un nom complet valide (au moins 2 caractères).',
        },
        { status: 400 }
      );
    }

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_EMAIL',
          message: 'Veuillez saisir une adresse email valide.',
        },
        { status: 400 }
      );
    }

    if (!cleanPassword || cleanPassword.length < 6) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_PASSWORD',
          message: 'Le mot de passe doit comporter au moins 6 caractères.',
        },
        { status: 400 }
      );
    }

    if (!cleanCompanyName || cleanCompanyName.length < 2) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_COMPANY_NAME',
          message: 'Veuillez saisir un nom d’entreprise valide (au moins 2 caractères).',
        },
        { status: 400 }
      );
    }

    // ── Primary Path: Supabase Auth & Tenant Provisioning ─────────────────────
    if (isSupabaseConfigured()) {
      const adminClient = createAdminClient();
      if (!adminClient) {
        return NextResponse.json(
          {
            success: false,
            error: 'SERVER_CONFIG_ERROR',
            message: 'Service Supabase momentanément indisponible.',
          },
          { status: 500 }
        );
      }

      // 1. Check for existing profile with same email (duplicate email prevention)
      const { data: existingProfile } = await (adminClient as any)
        .from('profiles')
        .select('id, email')
        .eq('email', cleanEmail)
        .maybeSingle();

      if (existingProfile) {
        return NextResponse.json(
          {
            success: false,
            error: 'EMAIL_ALREADY_EXISTS',
            message: 'Un compte existe déjà avec cette adresse email.',
          },
          { status: 409 }
        );
      }

      // 2. Create user in Supabase Auth via standard client (respects confirmation settings)
      const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });

      const { data: authData, error: signUpError } = await anonClient.auth.signUp({
        email: cleanEmail,
        password: cleanPassword,
      });

      if (signUpError) {
        const isDuplicate =
          signUpError.message?.toLowerCase().includes('already registered') ||
          signUpError.message?.toLowerCase().includes('already exists') ||
          (signUpError as any).status === 422;

        return NextResponse.json(
          {
            success: false,
            error: isDuplicate ? 'EMAIL_ALREADY_EXISTS' : 'AUTH_SIGNUP_ERROR',
            message: isDuplicate
              ? 'Un compte existe déjà avec cette adresse email.'
              : signUpError.message,
          },
          { status: isDuplicate ? 409 : 400 }
        );
      }

      // Detection for obfuscated duplicate email responses from Supabase (identities array empty)
      if (
        authData.user &&
        Array.isArray(authData.user.identities) &&
        authData.user.identities.length === 0
      ) {
        return NextResponse.json(
          {
            success: false,
            error: 'EMAIL_ALREADY_EXISTS',
            message: 'Un compte existe déjà avec cette adresse email.',
          },
          { status: 409 }
        );
      }

      const userId = authData.user?.id;
      if (!userId) {
        return NextResponse.json(
          {
            success: false,
            error: 'AUTH_FAILED',
            message: 'Impossible de générer l’identifiant utilisateur.',
          },
          { status: 500 }
        );
      }

      // 3. Atomically provision Company, Profile, Team Member, and Subscription
      let companyId: string | null = null;
      let companyRecord: any = null;
      let profileRecord: any = null;

      // Try RPC first (transactional inside Postgres)
      const { data: rpcResult, error: rpcError } = await (adminClient as any).rpc(
        'create_workspace_and_owner',
        {
          p_user_id: userId,
          p_email: cleanEmail,
          p_name: cleanName,
          p_phone: cleanPhone || null,
          p_company_name: cleanCompanyName,
          p_country: cleanCountry,
          p_currency: cleanCurrency,
          p_language: 'fr',
        }
      );

      if (!rpcError && rpcResult?.company) {
        companyRecord = rpcResult.company;
        profileRecord = rpcResult.profile;
        companyId = companyRecord.id;
      } else {
        // Fallback: Step-by-step admin provisioning with strict rollback cleanup
        try {
          // A. Insert Company
          const { data: comp, error: compErr } = await (adminClient as any)
            .from('companies')
            .insert({
              name: cleanCompanyName,
              country: cleanCountry,
              currency: cleanCurrency,
              language: 'fr',
              plan: 'starter',
              status: 'active',
            })
            .select()
            .single();

          if (compErr || !comp) {
            throw new Error(compErr?.message || 'Erreur lors de la création de l’entreprise.');
          }
          companyRecord = comp;
          companyId = comp.id;

          // B. Insert Profile (Enforce owner role server-side)
          const { data: prof, error: profErr } = await (adminClient as any)
            .from('profiles')
            .insert({
              id: userId,
              email: cleanEmail,
              name: cleanName,
              phone: cleanPhone || null,
              role: 'owner',
              company_id: companyId,
            })
            .select()
            .single();

          if (profErr || !prof) {
            throw new Error(profErr?.message || 'Erreur lors de la création du profil.');
          }
          profileRecord = prof;

          // C. Insert Team Member as active owner
          const { error: tmErr } = await (adminClient as any).from('team_members').insert({
            company_id: companyId,
            user_id: userId,
            name: cleanName,
            email: cleanEmail,
            role: 'owner',
            status: 'active',
          });

          if (tmErr) {
            throw new Error(tmErr.message || 'Erreur lors de la création du membre.');
          }

          // D. Insert Starter Subscription
          await (adminClient as any).from('subscriptions').insert({
            company_id: companyId,
            plan_id: 'starter',
            status: 'active',
            current_period_start: new Date().toISOString(),
            included_module_ids: [],
          });
        } catch (provisionErr: any) {
          // ── ROLLBACK & CLEANUP: Zero Orphan Records ────────────────────────
          if (companyId) {
            try {
              await (adminClient as any).from('companies').delete().eq('id', companyId);
            } catch {
              // Ignore secondary error
            }
          }
          try {
            await (adminClient as any).auth.admin.deleteUser(userId);
          } catch {
            // Ignore secondary error
          }

          return NextResponse.json(
            {
              success: false,
              error: 'PROVISIONING_FAILED',
              message: `Échec de l’initialisation de l’espace de travail: ${provisionErr.message}. Aucune donnée orpheline n’a été créée.`,
            },
            { status: 500 }
          );
        }
      }

      const requiresConfirmation =
        !authData.session && !authData.user?.confirmed_at;

      return NextResponse.json({
        success: true,
        requiresConfirmation,
        user: {
          id: userId,
          email: cleanEmail,
          name: cleanName,
          phone: cleanPhone,
          role: 'owner',
          company_id: companyId,
        },
        workspace: companyRecord,
        session: authData.session || null,
        message: requiresConfirmation
          ? 'Compte créé avec succès. Veuillez vérifier votre boîte email pour activer votre compte.'
          : 'Compte créé et initialisé avec succès.',
      });
    }

    // ── Fallback Path: Offline / Demo Storage ─────────────────────────────────
    const store = getStore();
    const existing = store.users.find(
      (u) => u.email.toLowerCase() === cleanEmail
    );

    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: 'EMAIL_ALREADY_EXISTS',
          message: 'Un compte existe déjà avec cette adresse email.',
        },
        { status: 409 }
      );
    }

    const newCompanyId = `ws-${Date.now()}`;
    const newUserId = `usr-${Date.now()}`;

    const newWorkspace = {
      id: newCompanyId,
      company_id: newCompanyId,
      name: cleanCompanyName,
      country: cleanCountry,
      currency: cleanCurrency,
      language: 'fr',
      created_at: new Date().toISOString(),
      plan: 'starter' as const,
      status: 'active' as const,
    };

    const newUser = {
      id: newUserId,
      email: cleanEmail,
      name: cleanName,
      phone: cleanPhone,
      role: 'owner' as const,
      company_id: newCompanyId,
      created_at: new Date().toISOString(),
    };

    const newMember = {
      id: `tm-${Date.now()}`,
      company_id: newCompanyId,
      user_id: newUserId,
      name: cleanName,
      email: cleanEmail,
      role: 'owner' as const,
      status: 'active' as const,
      joined_at: new Date().toISOString(),
    };

    store.workspaces.push(newWorkspace);
    store.users.push({ ...newUser, password_hash: cleanPassword });
    store.members.push(newMember);

    setStoreItem('WORKSPACES', store.workspaces);
    setStoreItem('USERS', store.users);
    setStoreItem('MEMBERS', store.members);

    return NextResponse.json({
      success: true,
      requiresConfirmation: false,
      user: newUser,
      workspace: newWorkspace,
      session: {
        user: newUser,
        workspace: newWorkspace,
        token: `mock_jwt_token_${newUserId}_${Date.now()}`,
      },
      message: 'Compte de démonstration créé avec succès.',
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: 'INTERNAL_SERVER_ERROR',
        message: err?.message || 'Une erreur imprévue est survenue lors de l’inscription.',
      },
      { status: 500 }
    );
  }
}
