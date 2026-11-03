// Read-only projection over the ONE Atlas domain model. The canonical source
// is a pinned public Atlas checkout bundled by Vite at build time.
// This is neither an organisational authorization nor a second project store.
import {deserialize, summary} from '../vendor/atlas/src/core.mjs';
import {portfolioNetwork} from '../vendor/atlas/src/portfolio.mjs';

export const ATLAS_SOURCE_REVISION = 'e5cc6ff593aa12eec3da8e8940ad5af5819b66fd';
export const ATLAS_SNAPSHOT_LIMIT = 16 * 1024 * 1024;
const fail = code => {throw Object.assign(new Error(code), {code});};

export function readAtlasPortfolio(raw) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > ATLAS_SNAPSHOT_LIMIT)
    fail('ATLAS_SNAPSHOT_SIZE_INVALID');
  let snapshot, network;
  try {
    snapshot = deserialize(raw);
    network = portfolioNetwork(snapshot);
  } catch {
    fail('ATLAS_SNAPSHOT_INVALID');
  }
  return {
    source: 'atlas.project/1',
    revision: String(snapshot.revision),
    projects: snapshot.projects.map(p => {
      const progress = summary(p);
      return {
        id: p.id, name: p.name, status: p.status,
        owner: p.owner || '', dueDate: p.dueDate || '',
        total: progress.total, done: progress.done, blocked: progress.blocked,
        progress: progress.progress, stages: p.stages.length,
        workItems: p.items.map(i => ({
          id: i.id, title: i.title, state: i.state,
          dueDate: i.dueDate || '', priority: i.priority
        }))
      };
    }),
    dependencies: network.links.map(d=>({from:d.from,to:d.to,kind:d.kind})),
    // The user-selected file is a source preview only. No membership, grant,
    // freshness guarantee, or project write authority is implied.
    authorization: 'NOT_CHECKED',
    mode: 'READ_ONLY_USER_SELECTED_FILE'
  };
}

export function linkableAtlasProject(view, projectId) {
  if (!view || view.source !== 'atlas.project/1' ||
      view.mode !== 'READ_ONLY_USER_SELECTED_FILE' ||
      view.authorization !== 'NOT_CHECKED') fail('ATLAS_PREVIEW_REQUIRED');
  const p = view.projects.find(p => p.id === projectId);
  if (!p) fail('ATLAS_PROJECT_NOT_IN_PREVIEW');
  return {projectId:p.id,revision:view.revision};
}

export function atlasLinkReadback(view, link) {
  if (!link || !view) return 'NOT_OBSERVED';
  const p = view.projects.find(p => p.id === link.projectId);
  if (!p) return 'PROJECT_MISSING_IN_SOURCE';
  return String(link.revision) === view.revision ? 'SOURCE_REVISION_MATCHES' : 'SOURCE_REVISION_CHANGED';
}
