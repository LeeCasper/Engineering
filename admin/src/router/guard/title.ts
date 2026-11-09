import type { Router } from 'vue-router';
import { applyDocumentTitle } from '@/utils/document-title';

export function createDocumentTitleGuard(router: Router) {
  router.afterEach(to => {
    applyDocumentTitle(to.meta);
  });
}
