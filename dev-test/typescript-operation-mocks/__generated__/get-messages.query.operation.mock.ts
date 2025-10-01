import type * as QueryTypes from '../query-types';
import * as Types from '../types.d.js';

export const fakeGetMessagesMessage = (
  overrides?: Partial<QueryTypes.GetMessages_Message>,
): QueryTypes.GetMessages_Message => {
  return {
    id: 'id',
    author: fakeGetMessagesAuthor(),
    date: 'a',
    ...overrides,
  };
};
export const fakeGetMessagesAuthor = (
  overrides?: Partial<QueryTypes.GetMessages_Author>,
): QueryTypes.GetMessages_Author => {
  return {
    name: 'name',
    adress: fakeGetMessagesAdress(),
    ...overrides,
  };
};
export const fakeGetMessagesAdress = (
  overrides?: Partial<QueryTypes.GetMessages_Adress>,
): QueryTypes.GetMessages_Adress => {
  return {
    street: 'street',
    city: 'city',
    country: 'country',
    ...overrides,
  };
};
