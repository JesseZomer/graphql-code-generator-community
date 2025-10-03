import type * as QueryTypes from './_query-types.ts';

export const fake_CreateMessage = (
  overrides?: Partial<QueryTypes.Mutation_CreateMessage>,
): QueryTypes.Mutation_CreateMessage => {
  return {
    id: 'id',
    ...overrides,
  };
};
export const fake_Messages = (
  overrides?: Partial<QueryTypes.Query_Messages>[],
  length: number = 2,
): QueryTypes.Query_Messages[] => {
  return Array.from({ length }, (_, i) => ({
    __typename: 'Message',
    id: 'id',
    type: 'COMMENT',
    active: true,
    numberOfComments: 1,
    cost: 1,
    authors: [fake_Messages_authors()],
    date: new Date(),
    replyTo: fake_Messages_replyto(),
    ...(overrides?.[i] || {}),
  }));
};
export const fake_Messages_authors = (
  overrides?: Partial<QueryTypes.Query_Messages_Authors>,
): QueryTypes.Query_Messages_Authors => {
  return {
    __typename: 'Author',
    id: 'id',
    name: 'name',
    ...overrides,
  };
};
export const fake_Messages_replyto = (
  overrides?: Partial<QueryTypes.Query_Messages_ReplyTo>,
): QueryTypes.Query_Messages_ReplyTo => {
  return {
    id: 'id',
    type: 'COMMENT',
    authors: [fake_Messages_replyto_authors()],
    ...overrides,
  };
};
export const fake_Messages_replyto_authors = (
  overrides?: Partial<QueryTypes.Query_Messages_ReplyTo_Authors>,
): QueryTypes.Query_Messages_ReplyTo_Authors => {
  return {
    id: 'id',
    name: 'name',
    ...overrides,
  };
};
