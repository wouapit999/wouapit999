import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorize, propertyWhere } from "@/lib/auth/context";
import { ForbiddenError } from "@/lib/errors";
import { buildModel } from "@/domain/building-3d";
import { renderBuildingSvg } from "@/domain/building-svg";

export const dynamic = "force-dynamic";

/**
 * Isometric picture of a building (SVG), generated from its floors, blocks and units.
 * Same scoping as the building pages: the caller must hold building.view and the property
 * must be inside their organization / property scope. Shown in the hover card next to building links.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let ctx;
  try {
    ctx = await authorize("building.view");
  } catch (e) {
    if (e instanceof ForbiddenError) {
      const status = e.message === "unauthenticated" ? 401 : 403;
      return NextResponse.json({ error: status === 401 ? "unauthenticated" : "forbidden" }, { status });
    }
    throw e;
  }
  const property = await db.property.findFirst({
    where: { ...propertyWhere(ctx), id },
    select: {
      name: true, floors: true, blocks: true,
      units: { where: { archived: false }, select: { id: true, number: true, block: true, floor: true, type: true, bedrooms: true, bathrooms: true, area: true, status: true } },
    },
  });
  if (!property) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const model = buildModel(
    { floors: property.floors, blocks: property.blocks },
    property.units.map((u) => ({ ...u, area: u.area ? Number(u.area) : null })),
  );
  const svg = renderBuildingSvg(model, { title: property.name });
  return new NextResponse(svg, {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "private, max-age=120", "X-Content-Type-Options": "nosniff" },
  });
}
