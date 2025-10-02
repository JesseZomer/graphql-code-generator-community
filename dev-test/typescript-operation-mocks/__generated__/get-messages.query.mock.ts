import * as Types from '../_base-types.js';
import type * as QueryTypes from './_query-types';

export const fake_messages = (
  overrides?: Partial<QueryTypes.Query_Messages>,
): QueryTypes.Query_Messages => {
  return {
    id: 'id',
    author: fake_messages_author(),
    date: 'a',
    replyTo: fake_messages_replyto(),
    ...overrides,
  };
};
export const fake_messages_author = (
  overrides?: Partial<QueryTypes.Query_Messages_Author>,
): QueryTypes.Query_Messages_Author => {
  return {
    name: 'name',
    adress: fake_messages_author_adress(),
    ...overrides,
  };
};
export const fake_messages_replyto = (
  overrides?: Partial<QueryTypes.Query_Messages_ReplyTo>,
): QueryTypes.Query_Messages_ReplyTo => {
  return {
    id: 'id',
    author: fake_messages_replyto_author(),
    ...overrides,
  };
};
export const fake_messages_author_adress = (
  overrides?: Partial<QueryTypes.Query_Messages_Author_Adress>,
): QueryTypes.Query_Messages_Author_Adress => {
  return {
    street: 'street',
    city: 'city',
    country: 'country',
    ...overrides,
  };
};
export const fake_messages_replyto_author = (
  overrides?: Partial<QueryTypes.Query_Messages_ReplyTo_Author>,
): QueryTypes.Query_Messages_ReplyTo_Author => {
  return {
    name: 'name',
    ...overrides,
  };
};
