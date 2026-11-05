import { NextRequest, NextResponse } from 'next/server';
import { requireServerAuth } from '@/lib/server-auth';
import { getModule } from '@/lib/modules';
import { assertSafeOutboundUrl } from '@/lib/registry';
import { buildPharmaStockSummary } from '../../../../../../../modules/pharmastock/src/index';
import { getGarageModuleSummary } from '@/lib/garage';
import { getSalonModuleSummary } from '@/lib/salon';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    slug: string;
  };
}

/**
 * GET /api/v1/modules/[slug]/summary
 *
 * Universal telemetry dispatcher for KaziBox modules.
 * Dynamically queries external HTTP summary endpoints first when configured,
 * and falls back to internal module summary providers.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const slug = params?.slug?.toLowerCase();
  const { searchParams } = new URL(req.url);
  const targetCompanyId = searchParams.get('companyId') || req.headers.get('x-workspace-id');

  const auth = await requireServerAuth(req, {
    targetCompanyId,
    requiredModuleId: slug,
  });
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  const companyId = auth.session.companyId;
  const mod = await getModule(slug);

  // 1. Dynamic Remote SaaS external module dispatcher (prioritized whenever an HTTP(S) summaryUrl is configured)
  if (mod?.summaryUrl && (mod.summaryUrl.startsWith('http://') || mod.summaryUrl.startsWith('https://'))) {
    const safety = await assertSafeOutboundUrl(mod.summaryUrl);
    if (!safety.safe) {
      return NextResponse.json(
        {
          error: 'Bad Gateway',
          code: 'UNSAFE_SUMMARY_URL',
          message: safety.reason || 'Module summary URL failed SSRF / redirect safety check.',
        },
        { status: 502 }
      );
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(mod.summaryUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          'X-Workspace-Id': companyId,
          Accept: 'application/json',
          ...(process.env.KAZIBOX_API_KEY ? { Authorization: `Bearer ${process.env.KAZIBOX_API_KEY}` } : {}),
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.status >= 300 && response.status < 400) {
        return NextResponse.json(
          {
            error: 'Bad Gateway',
            code: 'UNSAFE_SUMMARY_REDIRECT',
            message: 'Summary endpoint attempted an unsafe HTTP redirect.',
          },
          { status: 502 }
        );
      }

      if (response.ok) {
        const remoteSummary = await response.json();
        return NextResponse.json({
          moduleId: mod.id || slug,
          companyId,
          revenue: typeof remoteSummary.revenue === 'number' ? remoteSummary.revenue : 0,
          expenses: typeof remoteSummary.expenses === 'number' ? remoteSummary.expenses : 0,
          activityCount: typeof remoteSummary.activityCount === 'number' ? remoteSummary.activityCount : 0,
          currency: remoteSummary.currency || 'XOF',
          lastUpdated: remoteSummary.lastUpdated || new Date().toISOString(),
          metrics: Array.isArray(remoteSummary.metrics) ? remoteSummary.metrics : [],
        });
      }
    } catch (err) {
      console.warn(`[KaziBox] Remote telemetry fetch failed for module '${slug}' at ${mod.summaryUrl}:`, err);
    }
  }

  // 2. PharmaStock reference module (in-process fallback when summaryUrl is relative)
  if (slug === 'pharmastock' || slug === 'pharmacy') {
    const summary = await buildPharmaStockSummary(companyId);
    return NextResponse.json(summary);
  }

  // 3. Garage module
  if (slug === 'garage' || slug === 'garage-auto') {
    const summary = await getGarageModuleSummary(companyId);
    return NextResponse.json(summary);
  }

  // 4. Salon module
  if (slug === 'salon' || slug === 'hair-salon') {
    const summary = await getSalonModuleSummary(companyId);
    return NextResponse.json(summary);
  }

  // 5. Generic external module fallback
  return NextResponse.json({
    moduleId: mod?.id || slug,
    companyId,
    revenue: 0,
    expenses: 0,
    activityCount: 0,
    currency: 'XOF',
    lastUpdated: new Date().toISOString(),
    metrics: [
      {
        id: `${slug}-status`,
        moduleId: mod?.id || slug,
        label: { en: 'Module Status', fr: 'Statut du Module' },
        value: mod?.status || 'active',
        trend: 'neutral',
      },
    ],
  });
}
