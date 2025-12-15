import type * as QueryTypes from './_mocks.types';

export const fake_CreateMessage = (
  overrides?: Partial<Types.Mutation_CreateMessage>,
  arrayIndex = '',
): Types.Mutation_CreateMessage => {
  return {
    __typename: 'Message',
    id: `createMessage_id${arrayIndex ? `_${arrayIndex}` : ''}`,
    ...overrides,
  };
};

export const fake_Messages = (
  overrides?: Partial<Types.Query_Messages>[],
  length: number = 2,
): Types.Query_Messages[] => {
  return Array.from({ length }, (_, i) => ({
    __typename: 'Message',
    id: `messages_id_${i}`,
    type: Types.Type.COMMENT,
    active: true,
    numberOfComments: 1,
    cost: 1.0,
    comments: ['comments_0', 'comments_1'],
    authors: [
      fake_Messages_authors(undefined, `${i}_0`),
      fake_Messages_authors(undefined, `${i}_1`),
    ],
    date: new Date(),
    replyTo: fake_Messages_replyTo(undefined, `${i}`),
    food: fake_Messages_food_Potato(undefined, `${i}`),
    ...(overrides?.[i] || {}),
  }));
};

export const fake_Messages_authors = (
  overrides?: Partial<Types.Query_Messages_Authors>,
  arrayIndex = '',
): Types.Query_Messages_Authors => {
  return {
    __typename: 'Author',
    id: `messages_authors_id${arrayIndex ? `_${arrayIndex}` : ''}`,
    name: 'name',
    address: fake_Messages_authors_address(),
    ...overrides,
  };
};

export const fake_Messages_replyTo = (
  overrides?: Partial<Types.Query_Messages_ReplyTo>,
  arrayIndex = '',
): Types.Query_Messages_ReplyTo => {
  return {
    __typename: 'Message',
    id: `messages_replyTo_id${arrayIndex ? `_${arrayIndex}` : ''}`,
    type: Types.Type.COMMENT,
    authors: [
      fake_Messages_replyTo_authors(undefined, '0'),
      fake_Messages_replyTo_authors(undefined, '1'),
    ],
    ...overrides,
  };
};

export const fake_Messages_food_Potato = (
  overrides?: Partial<Types.Query_Messages_Food_Potato>,
  arrayIndex = '',
): Types.Query_Messages_Food_Potato => {
  return {
    __typename: 'Potato',
    id: `messages_food_Potato_id${arrayIndex ? `_${arrayIndex}` : ''}`,
    size: 1,
    color: 'color',
    ...overrides,
  };
};

export const fake_Messages_food_Tomato = (
  overrides?: Partial<Types.Query_Messages_Food_Tomato>,
  arrayIndex = '',
): Types.Query_Messages_Food_Tomato => {
  return {
    __typename: 'Tomato',
    id: `messages_food_Tomato_id${arrayIndex ? `_${arrayIndex}` : ''}`,
    origin: fake_Messages_food_Tomato_origin(),
    ...overrides,
  };
};

export const fake_Messages_authors_address = (
  overrides?: Partial<Types.Query_Messages_Authors_Address>,
  arrayIndex = '',
): Types.Query_Messages_Authors_Address => {
  return {
    __typename: 'Address',
    street: 'street',
    city: 'city',
    country: 'country',
    ...overrides,
  };
};

export const fake_Messages_replyTo_authors = (
  overrides?: Partial<Types.Query_Messages_ReplyTo_Authors>,
  arrayIndex = '',
): Types.Query_Messages_ReplyTo_Authors => {
  return {
    __typename: 'Author',
    id: `messages_replyTo_authors_id${arrayIndex ? `_${arrayIndex}` : ''}`,
    name: 'name',
    address: fake_Messages_replyTo_authors_address(),
    ...overrides,
  };
};

export const fake_Messages_food_Tomato_origin = (
  overrides?: Partial<Types.Query_Messages_Food_Tomato_Origin>,
  arrayIndex = '',
): Types.Query_Messages_Food_Tomato_Origin => {
  return {
    __typename: 'Address',
    street: 'street',
    city: 'city',
    country: 'country',
    ...overrides,
  };
};

export const fake_Messages_replyTo_authors_address = (
  overrides?: Partial<Types.Query_Messages_ReplyTo_Authors_Address>,
  arrayIndex = '',
): Types.Query_Messages_ReplyTo_Authors_Address => {
  return {
    __typename: 'Address',
    street: 'street',
    city: 'city',
    country: 'country',
    ...overrides,
  };
};
