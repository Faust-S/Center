import {emptyDraft, decodeDraft, encodeDraft} from '../src/organization.mjs';

// Adapts an existing T3 SubjectScopedStore; never creates a second storage engine.
// This holds preparation data only. It does not supply any organizational authority.
export function createDraftRepository(store) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') throw Error('T3_STORE_REQUIRED');
  return Object.freeze({
    load() {
      const stored = store.read();
      return {revision: stored.revision, draft: stored.bytes ? decodeDraft(Buffer.from(stored.bytes).toString('utf8')) : emptyDraft()};
    },
    save(draft, expectedRevision) {
      const bytes = Buffer.from(encodeDraft(draft), 'utf8');
      const receipt = store.write(expectedRevision, bytes);
      const readback = store.read();
      if (readback.revision !== receipt.revision || !Buffer.from(readback.bytes).equals(bytes)) throw Error('DRAFT_READBACK_MISMATCH');
      return {revision: readback.revision, draft: decodeDraft(readback.bytes.toString('utf8')), persisted: true};
    },
    close() { store.close(); }
  });
}
