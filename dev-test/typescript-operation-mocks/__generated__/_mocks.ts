import type * as QueryTypes from './_query-types.ts';

export const fake_CreateMessage = (
  arrayIndex: string = '',
  overrides?: Partial<QueryTypes.Mutation_CreateMessage>,
): QueryTypes.Mutation_CreateMessage => {
  return {
    id: `createMessage_id${arrayIndex ? `_${arrayIndex}` : ''}`,
    ...overrides,
  };
};
export const fake_Messages = (
  overrides?: Partial<QueryTypes.Query_Messages>[],
  length: number = 2,
): QueryTypes.Query_Messages[] => {
  return Array.from({ length }, (_, i) => ({
    __typename: 'Message',
    id: `messages_id_${i}`,
    type: 'COMMENT',
    active: true,
    numberOfComments: 1,
    cost: 1,
    comments: ['comments_0', 'comments_1'],
    authors: [fake_Messages_authors(`${i}_0`), fake_Messages_authors(`${i}_1`)],
    date: new Date(),
    replyTo: fake_Messages_replyto(`${i}`),
    food: fake_Messages_food_potato(`${i}`),
    ...(overrides?.[i] || {}),
  }));
};
export const fake_Messages_authors = (
  arrayIndex: string = '',
  overrides?: Partial<QueryTypes.Query_Messages_Authors>,
): QueryTypes.Query_Messages_Authors => {
  return {
    __typename: 'Author',
    id: `messages_authors_id${arrayIndex ? `_${arrayIndex}` : ''}`,
    name: 'name',
    address: fake_Messages_authors_address(''),
    ...overrides,
  };
};
export const fake_Messages_replyto = (
  arrayIndex: string = '',
  overrides?: Partial<QueryTypes.Query_Messages_ReplyTo>,
): QueryTypes.Query_Messages_ReplyTo => {
  return {
    id: `messages_replyTo_id${arrayIndex ? `_${arrayIndex}` : ''}`,
    type: 'COMMENT',
    authors: [fake_Messages_replyto_authors('0'), fake_Messages_replyto_authors('1')],
    ...overrides,
  };
};
export const fake_Messages_replyto_authors = (
  arrayIndex: string = '',
  overrides?: Partial<QueryTypes.Query_Messages_ReplyTo_Authors>,
): QueryTypes.Query_Messages_ReplyTo_Authors => {
  return {
    id: `messages_replyTo_authors_id${arrayIndex ? `_${arrayIndex}` : ''}`,
    name: 'name',
    address: fake_Messages_replyto_authors_address(''),
    ...overrides,
  };
};
export const fake_Messages_authors_address = (
  arrayIndex: string = '',
  overrides?: Partial<QueryTypes.Query_Messages_Authors_Address>,
): QueryTypes.Query_Messages_Authors_Address => {
  return {
    street: 'street',
    city: 'city',
    country: 'country',
    ...overrides,
  };
};
export const fake_Messages_food_potato = (
  arrayIndex: string = '',
  overrides?: Partial<QueryTypes.Query_Messages_Food_Potato>,
): QueryTypes.Query_Messages_Food_Potato => {
  return {
    id: `messages_food_Potato_id${arrayIndex ? `_${arrayIndex}` : ''}`,
    size: 1,
    color: 'color',
    ...overrides,
  };
};
export const fake_Messages_food_tomato = (
  arrayIndex: string = '',
  overrides?: Partial<QueryTypes.Query_Messages_Food_Tomato>,
): QueryTypes.Query_Messages_Food_Tomato => {
  return {
    id: `messages_food_Tomato_id${arrayIndex ? `_${arrayIndex}` : ''}`,
    origin: fake_Messages_food_tomato_origin(''),
    ...overrides,
  };
};
export const fake_Messages_replyto_authors_address = (
  arrayIndex: string = '',
  overrides?: Partial<QueryTypes.Query_Messages_ReplyTo_Authors_Address>,
): QueryTypes.Query_Messages_ReplyTo_Authors_Address => {
  return {
    street: 'street',
    city: 'city',
    country: 'country',
    ...overrides,
  };
};
export const fake_Messages_food_tomato_origin = (
  arrayIndex: string = '',
  overrides?: Partial<QueryTypes.Query_Messages_Food_Tomato_Origin>,
): QueryTypes.Query_Messages_Food_Tomato_Origin => {
  return {
    street: 'street',
    city: 'city',
    country: 'country',
    ...overrides,
  };
};
