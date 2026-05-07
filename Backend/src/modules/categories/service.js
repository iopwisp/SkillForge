/**
 * Categories service. Currently a thin wrapper around queries — kept for
 * boundary discipline (routes never call queries directly, even for tiny
 * modules) and as the place to add filtering / permissions / analytics later.
 */
import * as q from './queries.js';

export const list = () => q.listCategoriesWithCounts();
