import type { BuildingFace, Fixture, HouseModel, LightMountKind, Point } from "./house-distribution";
import { roofSurfaceAt, wallHeightAt, wallHeightProfile } from "./distribution-height-geometry";

type Position = [number, number, number];
export type MountedLight = { kind: LightMountKind; position: Position; normal?: Position; support?: { start: Position; end: Position }; wallId?: string };

/** Section-traced roof underside for the default model; alternative roofs remain illustrative. */
export function roofUndersideFaces(model: HouseModel, faces = model.envelope?.faces): BuildingFace[] | undefined {
  return faces === model.envelope?.faces ? model.envelope?.roofUnderside : undefined;
}

/** Roof underside, not a confirmed finished ceiling measurement. */
export function ceilingHeightAt(model: HouseModel, point: Point, faces = model.envelope?.faces): number {
  return ceilingSurfaceAt(model, point, faces).height;
}

function ceilingSurfaceAt(model: HouseModel, point: Point, faces?: BuildingFace[]) {
  const underside = roofSurfaceAt(point, roofUndersideFaces(model, faces));
  if (underside) return underside;
  const roof = roofSurfaceAt(point, faces);
  return { height: roof ? roof.height - .03 : 3, normal: roof?.normal ?? [0, 0, 1] as Position };
}

export function lightMount(model: HouseModel, fixture: Fixture, cutaway: boolean, faces = model.envelope?.faces): MountedLight {
  const kind=fixture.mount || (fixture.roomId === "exterior" ? (/wall|pared/i.test(fixture.type)?"wall":"ground") : /pendant|colgante/i.test(fixture.type)?"pendant":"ceiling");
  const [x,y]=fixture.position;
  if (cutaway && (kind === "ceiling" || kind === "pendant")) return { kind, position:[x,y,.025] };
  if (kind === "ground") {
    const height=Math.max(.15,fixture.heightMeasurement?.value ?? fixture.height);
    return { kind, position:[x,y,height], support:{start:[x,y,0],end:[x,y,height]} };
  }
  if (kind === "wall") {
    let nearest: { x:number; y:number; distance:number; id:string; thickness:number; height:number; dx:number; dy:number } | undefined;
    // Exterior lights must attach to the exterior wall, never an interior partition.
    const candidates=fixture.roomId === "exterior" ? model.walls.filter(w=>["front","back","left","right"].includes(w.id)) : model.walls;
    const requestedHeight=cutaway?Math.min(fixture.height,1.1):fixture.heightMeasurement?.value ?? fixture.height;
    for (const wall of candidates) {
      const dx=wall.end[0]-wall.start[0],dy=wall.end[1]-wall.start[1],length2=dx*dx+dy*dy;
      if (!length2) continue;
      const length=Math.sqrt(length2),height=cutaway?Math.min(wall.height,1.25):wall.height;
      const exteriorWall = ["front", "back", "left", "right"].includes(wall.id);
      const profile = wallHeightProfile({ ...wall, height }, cutaway ? undefined : roofUndersideFaces(model, faces), exteriorWall ? height : undefined);
      const projected=((x-wall.start[0])*dx+(y-wall.start[1])*dy)/length;
      const holes=model.openings.filter(o=>o.wallId===wall.id).map(o=>({start:o.offset,end:o.offset+o.width,bottom:o.sill,top:o.sill+o.height}));
      if (wall.id==="front") {
        for (const face of faces || []) {
          if (face.kind!=="glazing" || !face.vertices.every(v=>v[1]===0)) continue;
          const along=face.vertices.map(v=>((v[0]-wall.start[0])*dx+(v[1]-wall.start[1])*dy)/length);
          holes.push({start:Math.min(...along),end:Math.max(...along),bottom:Math.min(...face.vertices.map(v=>v[2])),top:Math.max(...face.vertices.map(v=>v[2]))});
        }
      }
      const cuts=[...new Set([0,length,...profile.flatMap(s=>[s.start,s.end]),...holes.flatMap(h=>[h.start,h.end]).filter(v=>v>0&&v<length)])].sort((a,b)=>a-b);
      const consider=(left:number,right:number,bottom:number,top:number,profileSegment:typeof profile[number])=>{
        if (right-left<=.001 || top-bottom<=.001) return;
        const horizontalPadding=Math.min(.08,(right-left)/2),verticalPadding=Math.min(.1,(top-bottom)/2);
        const minimumTop = bottom + Math.min(.1, (Math.max(wallHeightAt(profileSegment, left), wallHeightAt(profileSegment, right)) - bottom) / 2);
        const leftTop = wallHeightAt(profileSegment, left), rightTop = wallHeightAt(profileSegment, right);
        // Above a high opening, only part of a sloping band may contain solid wall.
        let solidLeft = left, solidRight = right;
        if (leftTop < minimumTop && rightTop > minimumTop) solidLeft = left + (right-left)*(minimumTop-leftTop)/(rightTop-leftTop);
        if (rightTop < minimumTop && leftTop > minimumTop) solidRight = left + (right-left)*(minimumTop-leftTop)/(rightTop-leftTop);
        if (solidRight-solidLeft <= .001) return;
        const padding = Math.min(horizontalPadding, (solidRight-solidLeft)/2);
        const along=Math.max(solidLeft+padding,Math.min(projected,solidRight-padding));
        const actualTop = Math.min(top, wallHeightAt(profileSegment, along));
        if (actualTop <= bottom + .001) return;
        const safePadding = Math.min(verticalPadding, (actualTop-bottom)/2);
        const z=Math.max(bottom+safePadding,Math.min(requestedHeight,actualTop-safePadding));
        const wx=wall.start[0]+along*dx/length,wy=wall.start[1]+along*dy/length;
        const distance=Math.hypot(x-wx,y-wy,requestedHeight-z);
        if (!nearest || distance<nearest.distance) nearest={x:wx,y:wy,distance,id:wall.id,thickness:wall.thickness,height:z,dx,dy};
      };
      for(let i=0;i<cuts.length-1;i++){
        const left=cuts[i],right=cuts[i+1],middle=(left+right)/2;
        const profileSegment = profile.find(s=>middle>=s.start&&middle<=s.end)!;
        const maxHeight = Math.max(profileSegment.startHeight,profileSegment.endHeight);
        const blocked=holes.filter(h=>middle>h.start&&middle<h.end&&h.top>0&&h.bottom<maxHeight).sort((a,b)=>a.bottom-b.bottom);
        let bottom=0;
        for(const hole of blocked){consider(left,right,bottom,Math.min(maxHeight,hole.bottom),profileSegment);bottom=Math.max(bottom,hole.top);}
        consider(left,right,bottom,maxHeight,profileSegment);
      }
    }
    if (!nearest) return {kind,position:[x,y,.025]};
    const length=Math.hypot(nearest.dx,nearest.dy), side=(x-nearest.x)*(-nearest.dy)+(y-nearest.y)*nearest.dx < 0 ? -1 : 1;
    const nx=side*(-nearest.dy)/length,ny=side*nearest.dx/length;
    const anchor: Position=[nearest.x+nx*nearest.thickness/2,nearest.y+ny*nearest.thickness/2,nearest.height];
    const position: Position=[anchor[0]+nx*.08,anchor[1]+ny*.08,anchor[2]];
    return {kind,position,normal:[nx,ny,0],wallId:nearest.id,support:{start:anchor,end:position}};
  }
  const ceiling=ceilingSurfaceAt(model,fixture.position,faces);
  if (kind === "pendant") {
    const height=Math.max(.15,Math.min(fixture.heightMeasurement?.value ?? ceiling.height-.35,ceiling.height-.15));
    return {kind,position:[x,y,height],support:{start:[x,y,ceiling.height],end:[x,y,height]}};
  }
  return {kind,position:[x,y,ceiling.height-.025],normal:ceiling.normal};
}
