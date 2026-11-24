export interface DrawioParseResult {
  hasMetadata: boolean;
  sysmlSource: string;
  viewType?: string;
  updatedPositions: Map<string, { x: number; y: number; width?: number; height?: number }>;
}

export class DrawioParser {
  public static parse(xmlContent: string): DrawioParseResult {
    // 1. Check for embedded sysmlSource metadata (Case A)
    const metaMatch = xmlContent.match(/sysmlSource="([^"]+)"/) || xmlContent.match(/sysmlSource='([^']+)'/);
    const viewTypeMatch = xmlContent.match(/viewType="([^"]+)"/) || xmlContent.match(/viewType='([^']+)'/);
    const viewType = viewTypeMatch ? viewTypeMatch[1] : undefined;

    const updatedPositions = new Map<string, { x: number; y: number; width?: number; height?: number }>();

    // 1. Extract geometries from UserObject elements
    const userObjRegex = /<UserObject\s+[^>]*?id="([^"]+)"[^>]*>[\s\S]*?<mxGeometry\s+([^>]+?)\/?>/g;
    let uMatch: RegExpExecArray | null;
    while ((uMatch = userObjRegex.exec(xmlContent)) !== null) {
      const id = uMatch[1];
      const geomAttr = uMatch[2];
      const xMatch = geomAttr.match(/x="([^"]+)"/);
      const yMatch = geomAttr.match(/y="([^"]+)"/);
      const wMatch = geomAttr.match(/width="([^"]+)"/);
      const hMatch = geomAttr.match(/height="([^"]+)"/);
      if (id && xMatch && yMatch) {
        updatedPositions.set(id, {
          x: parseFloat(xMatch[1]),
          y: parseFloat(yMatch[1]),
          width: wMatch ? parseFloat(wMatch[1]) : undefined,
          height: hMatch ? parseFloat(hMatch[1]) : undefined,
        });
      }
    }

    // 2. Extract geometries from standard mxCell vertex elements
    const cellGeomRegex = /<mxCell\s+[^>]*?id="([^"]+)"[^>]*?vertex="1"[^>]*>[\s\S]*?<mxGeometry\s+([^>]+?)\/?>/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = cellGeomRegex.exec(xmlContent)) !== null) {
      const id = cMatch[1];
      if (updatedPositions.has(id)) continue;
      const geomAttr = cMatch[2];
      const xMatch = geomAttr.match(/x="([^"]+)"/);
      const yMatch = geomAttr.match(/y="([^"]+)"/);
      const wMatch = geomAttr.match(/width="([^"]+)"/);
      const hMatch = geomAttr.match(/height="([^"]+)"/);
      if (id && xMatch && yMatch) {
        updatedPositions.set(id, {
          x: parseFloat(xMatch[1]),
          y: parseFloat(yMatch[1]),
          width: wMatch ? parseFloat(wMatch[1]) : undefined,
          height: hMatch ? parseFloat(hMatch[1]) : undefined,
        });
      }
    }

    if (metaMatch) {
      const decodedSource = decodeURIComponent(metaMatch[1]);
      return {
        hasMetadata: true,
        sysmlSource: decodedSource,
        viewType,
        updatedPositions,
      };
    }

    // 2. Plain hand-drawn Draw.io diagram -> Synthesize SysML v2 source (Case B)
    const synthesizedSource = DrawioParser.synthesizeFromPlainXml(xmlContent);
    return {
      hasMetadata: false,
      sysmlSource: synthesizedSource,
      viewType: "general",
      updatedPositions,
    };
  }

  private static stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static toIdentifier(str: string, fallback: string): string {
    const clean = str.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
    return clean.length > 0 ? clean : fallback;
  }

  /**
   * Universal regex-based reverse-compiler for plain hand-drawn draw.io diagrams.
   */
  public static synthesizeFromPlainXml(xmlContent: string): string {
    interface RawNode {
      id: string;
      name: string;
      parentId: string;
      children: RawNode[];
    }

    interface RawEdge {
      id: string;
      name: string;
      sourceId: string;
      targetId: string;
    }

    const nodeMap = new Map<string, RawNode>();
    const edgeList: RawEdge[] = [];

    // Match vertices: <mxCell id="id" value="val" ... vertex="1" ... parent="parentId" ...>
    const cellRegex = /<mxCell\s+([^>]+?)\/?>/g;
    let match: RegExpExecArray | null;
    let nodeCount = 1;
    let edgeCount = 1;

    while ((match = cellRegex.exec(xmlContent)) !== null) {
      const attrs = match[1];

      const isVertex = /vertex="1"/.test(attrs);
      const isEdge = /edge="1"/.test(attrs);

      const idMatch = attrs.match(/id="([^"]+)"/);
      const valMatch = attrs.match(/value="([^"]*)"/);
      const parentMatch = attrs.match(/parent="([^"]+)"/);
      const sourceMatch = attrs.match(/source="([^"]+)"/);
      const targetMatch = attrs.match(/target="([^"]+)"/);

      if (isVertex && idMatch) {
        const id = idMatch[1];
        const rawVal = valMatch ? valMatch[1] : "";
        const cleanText = DrawioParser.stripHtml(rawVal);
        const name = DrawioParser.toIdentifier(cleanText, `Item_${nodeCount++}`);
        const parentId = parentMatch ? parentMatch[1] : "1";

        nodeMap.set(id, {
          id,
          name,
          parentId,
          children: [],
        });
      } else if (isEdge && idMatch && sourceMatch && targetMatch) {
        const id = idMatch[1];
        const rawVal = valMatch ? valMatch[1] : "";
        const cleanText = DrawioParser.stripHtml(rawVal);
        const name = DrawioParser.toIdentifier(cleanText, `c_${edgeCount++}`);

        edgeList.push({
          id,
          name,
          sourceId: sourceMatch[1],
          targetId: targetMatch[1],
        });
      }
    }

    // Build hierarchy
    const rootNodes: RawNode[] = [];
    nodeMap.forEach((node) => {
      if (node.parentId !== "0" && node.parentId !== "1" && nodeMap.has(node.parentId)) {
        const parent = nodeMap.get(node.parentId)!;
        parent.children.push(node);
      } else {
        rootNodes.push(node);
      }
    });

    // Generate SysML source code
    const lines: string[] = [];
    lines.push(`package ImportedSystem {`);

    const renderNode = (node: RawNode, indent: string) => {
      if (node.children.length > 0) {
        lines.push(`${indent}part def ${node.name} {`);
        for (const child of node.children) {
          renderNode(child, `${indent}    `);
        }
        lines.push(`${indent}}`);
      } else {
        lines.push(`${indent}part ${node.name};`);
      }
    };

    for (const root of rootNodes) {
      renderNode(root, "    ");
    }

    // Render connections
    for (const edge of edgeList) {
      const srcNode = nodeMap.get(edge.sourceId);
      const tgtNode = nodeMap.get(edge.targetId);
      if (srcNode && tgtNode) {
        lines.push(`    connection ${edge.name} connect ${srcNode.name} to ${tgtNode.name};`);
      }
    }

    lines.push(`}`);
    lines.push(``);

    return lines.join("\n");
  }
}
