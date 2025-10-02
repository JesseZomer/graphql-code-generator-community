import * as Types from '../_base-types.js';
import type * as QueryTypes from './_query-types';

export const fake_createmessage = (
  overrides?: Partial<QueryTypes.Mutation_CreateMessage>,
): QueryTypes.Mutation_CreateMessage => {
  return {
    id: 'id',
    ...overrides,
  };
};
