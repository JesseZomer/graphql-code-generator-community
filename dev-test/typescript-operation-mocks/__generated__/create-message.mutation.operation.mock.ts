import type * as QueryTypes from '../query-types';
import * as Types from '../types.d.js';

export const fakeCreateMessageMessage = (
  overrides?: Partial<QueryTypes.CreateMessage_Message>,
): QueryTypes.CreateMessage_Message => {
  return {
    id: 'id',
    ...overrides,
  };
};
