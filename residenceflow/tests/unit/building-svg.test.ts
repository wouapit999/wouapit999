import { describe, expect, it } from "vitest";
import { buildModel } from "@/domain/building-3d";
import { project, renderBuildingSvg } from "@/domain/building-svg";

describe("building svg", () => {
  it("projects higher points upwards and nearer points downwards on screen", () => {
    expect(project(0, 3, 0).v).toBeLessThan(project(0, 0, 0).v);
    expect(project(5, 0, 5).v).toBeGreaterThan(project(0, 0, 0).v);
  });
  it("renders one polygon trio per box with status colours and escapes the title", () => {
    const m = buildModel({ floors: 2, blocks: 1 }, [
      { id: "a", number: "1A", block: "", floor: 1, type: "APARTMENT", bedrooms: 2, bathrooms: 1, area: 70, status: "OCCUPIED" },
      { id: "b", number: "0A", block: "", floor: 0, type: "SHOP", bedrooms: 0, bathrooms: 0, area: 40, status: "VACANT" },
    ]);
    const svg = renderBuildingSvg(m, { title: 'Résidence <A&B>' });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<title>Résidence &lt;A&amp;B&gt;</title>");
    expect(svg).toContain("#30c28d"); // front face of the OCCUPIED unit: #34d399 shaded to 92 %
    const polygons = svg.match(/<polygon/g)?.length ?? 0;
    // 2 slabs + 1 core + 2 units + 1 roof = 6 boxes × 3 faces
    expect(polygons).toBe(18);
  });
  it("renders an empty building without throwing", () => {
    expect(renderBuildingSvg(buildModel({ floors: 1, blocks: 1 }, []))).toContain("viewBox");
  });
});
