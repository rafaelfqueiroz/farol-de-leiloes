// A deliberately broken module for dist-import-graph.spec.ts: papaparse is a UMD bundle, so Node
// exposes no named `parse` export to ESM and refuses to link this file.
import { parse } from 'papaparse';

export const unreachable = parse;
